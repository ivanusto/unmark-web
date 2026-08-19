#!/usr/bin/env python3
"""unmark-stat — local-only sidecar for *statistical* text watermarks.

Gives the web UI real detection (and demo generation) for two published
token-level watermark schemes, via Hugging Face transformers:

    kgw            Kirchenbauer et al. "A Watermark for Large Language Models"
                   (green-list / z-score), `WatermarkingConfig` + `WatermarkDetector`
    synthid-text   SynthID-Text (Dathathri et al., Nature 2024), `SynthIDTextWatermarkingConfig`
                   + `BayesianDetectorModel` + `SynthIDTextWatermarkDetector`

Both schemes are *keyed*: detection is only meaningful for text produced by the
same tokenizer/model family, the same scheme, and the same key. We ship two
public experiment profiles ("a" and "b") so the demo can show a match and a
mismatch side by side. A model you do not hold keys for cannot be judged here.

    GET  /health
    POST /detect    {"text": ..., "detectors": ["kgw","synthid-text"], "key_profile": "a"|"b"}
    POST /generate  {"prompt": ..., "scheme": "kgw"|"synthid"|"none", "key_profile": "a"|"b", "max_new_tokens": N}

Runs on 127.0.0.1 only. Needs torch + transformers>=4.57 and (realistically) a
GPU; the default model is Qwen/Qwen3-4B-Instruct-2507 in bf16 (~8 GB). Model,
tokenizer and detectors are loaded lazily on first use, one job at a time.
Point serve_local.py at it with --stat-upstream http://127.0.0.1:8767 and the
UI reaches it same-origin under /stat/*.

    python3 sidecar/unmark_stat.py                     # 127.0.0.1:8767
    python3 sidecar/unmark_stat.py --port 8767 --api-key "$KEY" --no-generate
    UNMARK_STAT_PORT / UNMARK_STAT_API_KEY are the env equivalents.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import threading
import time
import traceback
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
KEYS_DIR = HERE / "keys"

DEFAULT_MODEL = "Qwen/Qwen3-4B-Instruct-2507"
# Detector bundles trained for that model on the two public experiment keys
# (MIT, https://huggingface.co/xlr8harder/synthid-qwen3-4b-instruct-2507-detectors).
SYNTHID_DETECTOR_REPO = "xlr8harder/synthid-qwen3-4b-instruct-2507-detectors"
SYNTHID_DETECTOR_SUBFOLDER = {"a": "same-model-matched/key-a/model", "b": "same-model-matched/key-b/model"}
SYNTHID_DETECTOR_EVAL_SUBFOLDER = {"a": "same-model-matched/key-a", "b": "same-model-matched/key-b"}
# Generation profile the SynthID detectors were fit on ("synthid-paper-t0.7-k100-p1.0"
# in the bundle README). Sampler settings are part of detector provenance.
SYNTHID_SAMPLER = {"temperature": 0.7, "top_k": 100, "top_p": 1.0}
KGW_SAMPLER = {"temperature": 0.7, "top_k": 0, "top_p": 1.0}

# KGW key profiles. HF's WatermarkingConfig takes one integer `hashing_key`;
# the original KGW reference uses 15485863 (the 1,000,000th prime) as its
# default, which we keep as profile "a". Profile "b" is the 2,000,000th prime,
# 32452843 — any distinct integer would do, it only has to be different.
KGW_PROFILES = {"a": 15485863, "b": 32452843}
# gamma 0.25 is the paper default. Seeding is "lefthash" with context_width 1
# (the paper's simple_1 scheme: greenlist seeded by the previous token) rather
# than HF's "selfhash": with context_width 1, HF's selfhash seeds on the
# candidate token *alone*, which degenerates into a fixed green/red partition of
# the vocabulary — unwatermarked text then lands at z = +-4 purely from its
# token distribution, and the generation-side bias is weak. delta (bias) only
# matters for generation; the paper's 2.0 gave z ~ 4.4-5.2 at 450 tokens on
# this low-entropy instruct model, 3.0 gives z ~ 7. Measured, see README.md.
KGW_PARAMS = {"greenlist_ratio": 0.25, "bias": 3.0, "seeding_scheme": "lefthash", "context_width": 1}
KGW_Z_DETECTED = 4.0
KGW_Z_CLEAN = 2.0
KGW_MIN_TOKENS = 50

# SynthID decision bounds. The upper bound comes from the bundle's own
# evaluation-summary.json (threshold calibrated to 1 % validation FPR at the
# nearest evaluated length <= tokens scored). The lower bound is ours: in the
# bundle's released per-sample scores, ~60 % of 200-token negatives (human
# ELI5, unwatermarked Qwen, other-key Qwen) fall below 0.12 while only ~2 % of
# matching-key positives do, so "posterior < 0.12" is a reasonable "clean".
SYNTHID_FPR_TARGET = "0.01"
SYNTHID_CLEAN_BELOW = 0.12
SYNTHID_MIN_TOKENS = 100  # detectors were evaluated at >=100/200 tokens; below that say "uncertain"

MAX_BODY = 2 << 20
MAX_NEW_TOKENS = 1024
MAX_DETECT_TOKENS = 4096  # longer inputs are truncated before scoring; reported in meta

DETECTOR_IDS = ("kgw", "synthid-text")
PROFILES = ("a", "b")


def log(msg: str) -> None:
    sys.stderr.write(time.strftime("%H:%M:%S ") + msg + "\n")
    sys.stderr.flush()


# ---------------------------------------------------------------- engine


class Engine:
    """Owns the model, tokenizer and detectors. Everything lazy, one GPU job at a time."""

    def __init__(self, model_id: str, device: str, allow_generate: bool) -> None:
        self.model_id = model_id
        self.device_pref = device
        self.allow_generate = allow_generate
        self.lock = threading.Lock()
        self.device: str | None = None
        self.model = None
        self.tokenizer = None
        self.kgw_detectors: dict[str, object] = {}
        self.synthid: dict[str, dict] = {}
        self.synthid_keys: dict[str, dict] = {}
        for p in PROFILES:
            f = KEYS_DIR / f"key-{p}.json"
            if f.is_file():
                self.synthid_keys[p] = json.loads(f.read_text(encoding="utf-8"))

    # -- loading -----------------------------------------------------------

    def _resolve_device(self) -> str:
        if self.device:
            return self.device
        import torch
        d = self.device_pref
        if d == "auto":
            d = "cuda" if torch.cuda.is_available() else "cpu"
        self.device = d
        return d

    def ensure_model(self) -> None:
        if self.model is not None:
            return
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        dev = self._resolve_device()
        log(f"loading {self.model_id} on {dev} ...")
        t0 = time.time()
        self.tokenizer = AutoTokenizer.from_pretrained(self.model_id)
        dtype = torch.bfloat16 if dev != "cpu" else torch.float32
        self.model = AutoModelForCausalLM.from_pretrained(self.model_id, dtype=dtype)
        self.model.to(dev)
        self.model.eval()
        log(f"model ready in {time.time() - t0:.1f}s")

    def ensure_tokenizer(self) -> None:
        if self.tokenizer is None:
            from transformers import AutoTokenizer
            self.tokenizer = AutoTokenizer.from_pretrained(self.model_id)

    def kgw_config(self, profile: str):
        from transformers import WatermarkingConfig
        return WatermarkingConfig(hashing_key=KGW_PROFILES[profile], **KGW_PARAMS)

    def ensure_kgw(self, profile: str):
        if profile in self.kgw_detectors:
            return self.kgw_detectors[profile]
        from transformers import AutoConfig, WatermarkDetector
        # The detector only needs vocab_size from the model config, so it works
        # without the 8 GB of weights; the hash itself runs on `device`.
        cfg = self.model.config if self.model is not None else AutoConfig.from_pretrained(self.model_id)
        det = WatermarkDetector(model_config=cfg, device=self._resolve_device(),
                               watermarking_config=self.kgw_config(profile))
        self.kgw_detectors[profile] = det
        return det

    def synthid_config(self, profile: str):
        from transformers import SynthIDTextWatermarkingConfig
        cfg = self.synthid_keys[profile]["config"]
        return SynthIDTextWatermarkingConfig(
            ngram_len=int(cfg["ngram_len"]),
            keys=[int(k) for k in cfg["keys"]],
            context_history_size=int(cfg["context_history_size"]),
            sampling_table_seed=int(cfg["sampling_table_seed"]),
            sampling_table_size=int(cfg["sampling_table_size"]),
            skip_first_ngram_calls=bool(cfg.get("skip_first_ngram_calls", False)),
        )

    def ensure_synthid(self, profile: str) -> dict:
        if profile in self.synthid:
            return self.synthid[profile]
        if profile not in self.synthid_keys:
            raise RuntimeError(f"no SynthID key file for profile {profile!r} (expected sidecar/keys/key-{profile}.json)")
        import torch
        from huggingface_hub import hf_hub_download
        from transformers import BayesianDetectorModel, SynthIDTextWatermarkDetector, SynthIDTextWatermarkLogitsProcessor
        self.ensure_tokenizer()
        dev = self._resolve_device()
        sub = SYNTHID_DETECTOR_SUBFOLDER[profile]
        log(f"loading SynthID detector {SYNTHID_DETECTOR_REPO}/{sub} ...")
        det_model = BayesianDetectorModel.from_pretrained(SYNTHID_DETECTOR_REPO, subfolder=sub)
        det_model.to(dev).eval()
        cfg = self.synthid_keys[profile]["config"]
        proc = SynthIDTextWatermarkLogitsProcessor(
            ngram_len=int(cfg["ngram_len"]), keys=[int(k) for k in cfg["keys"]],
            sampling_table_size=int(cfg["sampling_table_size"]), sampling_table_seed=int(cfg["sampling_table_seed"]),
            context_history_size=int(cfg["context_history_size"]), device=dev,
            skip_first_ngram_calls=bool(cfg.get("skip_first_ngram_calls", False)),
        )
        # The bundle ships the exact sampling table its detector was trained
        # against (little-endian int64, sha256 in synthid-detector-bundle.json).
        # HF regenerates the table from (seed, size) with torch.randint, whose
        # stream differs between CPU and CUDA generators — so we compare bytes
        # and, on mismatch, load the bundle's table into the processor. The
        # generation side uses the same processor object, so both directions
        # stay consistent with the bundle.
        table_note = None
        try:
            table_path = hf_hub_download(SYNTHID_DETECTOR_REPO, "sampling-table.int64le", subfolder=sub)
            bundle_path = hf_hub_download(SYNTHID_DETECTOR_REPO, "synthid-detector-bundle.json", subfolder=sub)
            raw = Path(table_path).read_bytes()
            want = json.loads(Path(bundle_path).read_text(encoding="utf-8")).get("sampling_table", {}).get("sha256")
            got = hashlib.sha256(raw).hexdigest()
            if want and got != want:
                raise RuntimeError(f"bundle sampling table sha256 mismatch: {got} != {want}")
            ours = proc.sampling_table.detach().to("cpu").to(torch.int64).numpy().astype("<i8").tobytes()
            if ours == raw:
                table_note = "sampling table: HF-generated == bundle"
            else:
                import numpy as np
                arr = np.frombuffer(raw, dtype="<i8").copy()
                proc.sampling_table = torch.from_numpy(arr).to(dev)
                table_note = "sampling table: loaded from bundle file (HF-generated table differed on this device)"
            log(f"synthid[{profile}] {table_note}")
        except Exception as e:  # noqa: BLE001 — keep going with the HF table, but say so
            table_note = f"sampling table: could not verify against bundle ({e})"
            log(f"synthid[{profile}] {table_note}")
        thresholds = self._synthid_thresholds(profile)
        detector = SynthIDTextWatermarkDetector(det_model, proc, self.tokenizer)
        entry = {"detector": detector, "processor": proc, "model": det_model, "thresholds": thresholds,
                 "table_note": table_note}
        self.synthid[profile] = entry
        return entry

    def _synthid_thresholds(self, profile: str) -> dict[int, float]:
        """{tokens: posterior threshold at the 1 % validation-FPR operating point}."""
        from huggingface_hub import hf_hub_download
        out: dict[int, float] = {}
        try:
            p = hf_hub_download(SYNTHID_DETECTOR_REPO, "evaluation-summary.json",
                                subfolder=SYNTHID_DETECTOR_EVAL_SUBFOLDER[profile])
            ops = json.loads(Path(p).read_text(encoding="utf-8")).get("operating_points", {})
            for n, op in ops.items():
                thr = (op.get("thresholds") or {}).get(SYNTHID_FPR_TARGET)
                if thr is not None:
                    out[int(n)] = float(thr)
        except Exception as e:  # noqa: BLE001
            log(f"synthid[{profile}] could not read evaluation-summary.json: {e}")
        if not out:
            # Fallback: the 1 %-FPR thresholds recorded in detectors v1.0 at 200 tokens.
            out = {200: 0.9107565879821777 if profile == "a" else 0.9211171269416809}
        return out

    # -- public API --------------------------------------------------------

    def health(self) -> dict:
        import importlib.util
        have_torch = importlib.util.find_spec("torch") is not None
        have_tf = importlib.util.find_spec("transformers") is not None
        avail = have_torch and have_tf
        try:
            dev = self._resolve_device() if have_torch else "n/a"
        except Exception:  # noqa: BLE001
            dev = "n/a"
        dets = [
            {"id": "kgw", "available": avail, "requires_key": True, "requires_model": True,
             "key_profiles": list(PROFILES), "model": self.model_id,
             "note": "Kirchenbauer green-list watermark (HF WatermarkDetector, lefthash, context 1, gamma 0.25, delta 3.0). "
                     "Only detects text generated with the same tokenizer, scheme and hashing key."},
            {"id": "synthid-text", "available": avail and bool(self.synthid_keys), "requires_key": True,
             "requires_model": True, "key_profiles": sorted(self.synthid_keys), "model": self.model_id,
             "note": "SynthID-Text Bayesian detector trained for " + DEFAULT_MODEL + " on public experiment keys "
                     "(xlr8harder/synthid). Does not detect Gemini or any other vendor's SynthID key."},
        ]
        return {"ok": True, "device": dev, "model": self.model_id, "loaded": self.model is not None,
                "generate": self.allow_generate, "detectors": dets}

    def detect(self, text: str, detectors: list[str], profile: str) -> list[dict]:
        results = []
        with self.lock:
            for d in detectors:
                try:
                    if d == "kgw":
                        results.append(self._detect_kgw(text, profile))
                    elif d == "synthid-text":
                        results.append(self._detect_synthid(text, profile))
                except Exception as e:  # noqa: BLE001
                    log(f"detect {d} failed: {e}\n{traceback.format_exc()}")
                    results.append(unified(d, "error", note=f"{type(e).__name__}: {e}",
                                           meta={"model": self.model_id, "key_profile": profile}))
        return results

    def _encode(self, text: str):
        import torch
        self.ensure_tokenizer()
        ids = self.tokenizer(text, return_tensors="pt", add_special_tokens=False).input_ids
        truncated = ids.shape[1] > MAX_DETECT_TOKENS
        if truncated:
            ids = ids[:, :MAX_DETECT_TOKENS]
        return ids.to(self._resolve_device()), truncated

    def _detect_kgw(self, text: str, profile: str) -> dict:
        import torch
        det = self.ensure_kgw(profile)
        ids, truncated = self._encode(text)
        n_tokens = int(ids.shape[1])
        meta = {"model": self.model_id, "key_profile": profile, "tokens": n_tokens, "truncated": truncated,
                "hashing_key": KGW_PROFILES[profile], **KGW_PARAMS}
        if n_tokens < 2:
            return unified("kgw", "uncertain", note="too short to score", meta=meta)
        with torch.no_grad():
            out = det(ids, z_threshold=KGW_Z_DETECTED, return_dict=True)
        z = float(out.z_score[0])
        green = float(out.green_fraction[0])
        scored = int(out.num_tokens_scored[0])
        # One-sided p-value of the z-score under the null (H0: no watermark,
        # green fraction = gamma). HF's WatermarkDetectorOutput carries a rough
        # closed-form approximation; the exact normal tail is one erfc away.
        p = 0.5 * math.erfc(z / math.sqrt(2.0))
        conf = 1.0 - p
        meta["tokens_scored"] = scored
        evidence = [
            {"label": "z-score", "detail": f"{z:.2f} (detected >= {KGW_Z_DETECTED:g}, clean < {KGW_Z_CLEAN:g})"},
            {"label": "p-value", "detail": f"{p:.3g}"},
            {"label": "green fraction", "detail": f"{green:.3f} (expected {KGW_PARAMS['greenlist_ratio']:g} if unwatermarked)"},
            {"label": "tokens scored", "detail": str(scored)},
        ]
        note = None
        if scored < KGW_MIN_TOKENS:
            status = "uncertain"
            note = f"too short: {scored} tokens scored, need >= {KGW_MIN_TOKENS}"
        elif z >= KGW_Z_DETECTED:
            status = "detected"
        elif z < KGW_Z_CLEAN:
            status = "clean"
        else:
            status = "uncertain"
        return unified("kgw", status, confidence=max(0.0, min(1.0, conf)), score=z, threshold=KGW_Z_DETECTED,
                       evidence=evidence, note=note, meta=meta)

    def _detect_synthid(self, text: str, profile: str) -> dict:
        import torch
        entry = self.ensure_synthid(profile)
        ids, truncated = self._encode(text)
        n_tokens = int(ids.shape[1])
        proc = entry["processor"]
        meta = {"model": self.model_id, "key_profile": profile, "tokens": n_tokens, "truncated": truncated,
                "detector": f"{SYNTHID_DETECTOR_REPO}/{SYNTHID_DETECTOR_SUBFOLDER[profile]}",
                "ngram_len": int(proc.ngram_len), "table": entry["table_note"]}
        if n_tokens < proc.ngram_len + 1:
            return unified("synthid-text", "uncertain", note="too short to score", meta=meta)
        with torch.no_grad():
            # Same steps as SynthIDTextWatermarkDetector.__call__, kept inline so
            # we can report how many n-grams were actually scored (the mask).
            eos_mask = proc.compute_eos_token_mask(input_ids=ids, eos_token_id=self.tokenizer.eos_token_id)[:, proc.ngram_len - 1:]
            rep_mask = proc.compute_context_repetition_mask(input_ids=ids)
            mask = rep_mask * eos_mask
            g = proc.compute_g_values(input_ids=ids)
            out = entry["model"](g, mask, return_dict=True)
        posterior = float(out.posterior_probabilities[0])
        scored = int(mask.sum().item())
        meta["tokens_scored"] = scored
        thresholds = entry["thresholds"]
        # Nearest evaluated length not exceeding what we scored (capped at the
        # largest bucket the bundle reports).
        usable = [n for n in thresholds if n <= max(scored, min(thresholds))]
        bucket = max(usable) if usable else min(thresholds)
        thr = thresholds[bucket]
        meta["threshold_tokens"] = bucket
        evidence = [
            {"label": "posterior P(watermarked)", "detail": f"{posterior:.4f}"},
            {"label": "threshold", "detail": f"{thr:.4f} (1 % FPR operating point at {bucket} tokens); clean < {SYNTHID_CLEAN_BELOW:g}"},
            {"label": "n-grams scored", "detail": f"{scored} of {n_tokens} tokens"},
        ]
        note = None
        if scored < SYNTHID_MIN_TOKENS:
            status = "uncertain"
            note = f"too short: {scored} tokens scored, detector evaluated at >= {SYNTHID_MIN_TOKENS} (nominally 200)"
        elif posterior >= thr:
            status = "detected"
        elif posterior < SYNTHID_CLEAN_BELOW:
            status = "clean"
        else:
            status = "uncertain"
        return unified("synthid-text", status, confidence=posterior, score=posterior, threshold=thr,
                       evidence=evidence, note=note, meta=meta)

    def generate(self, prompt: str, scheme: str, profile: str, max_new_tokens: int) -> dict:
        import torch
        with self.lock:
            self.ensure_model()
            tok, model = self.tokenizer, self.model
            messages = [{"role": "user", "content": prompt}]
            try:
                # enable_thinking=False is honoured by the Qwen3 thinking
                # templates and ignored by the 2507 instruct one; we want the
                # prose, not a reasoning trace, in the watermark demo.
                enc = tok.apply_chat_template(messages, add_generation_prompt=True, return_tensors="pt",
                                              return_dict=True, enable_thinking=False)
                input_ids = enc["input_ids"]
            except Exception:  # noqa: BLE001 — tokenizer without a chat template
                input_ids = tok(prompt, return_tensors="pt").input_ids
            input_ids = input_ids.to(self._resolve_device())
            attention_mask = torch.ones_like(input_ids)
            from transformers import LogitsProcessorList, TemperatureLogitsWarper, TopKLogitsWarper, TopPLogitsWarper
            # Neutral built-in sampler (and no repetition penalty from the
            # model's generation_config.json) so the only transforms applied
            # are the ones we list here, in the order we list them.
            kw: dict = {"do_sample": True, "max_new_tokens": max_new_tokens, "attention_mask": attention_mask,
                        "pad_token_id": tok.pad_token_id if tok.pad_token_id is not None else tok.eos_token_id,
                        "temperature": 1.0, "top_k": 0, "top_p": 1.0, "min_p": None, "repetition_penalty": 1.0}
            if scheme == "kgw":
                sampler = dict(KGW_SAMPLER)
                kw.update(sampler)
                # HF appends the watermark processor after its own warpers.
                kw["watermarking_config"] = self.kgw_config(profile)
            else:
                sampler = dict(SYNTHID_SAMPLER)  # "none" uses the same sampler so it is a fair control
                # Paper / xlr8harder order: raw logits -> temperature -> top-k -> top-p -> SynthID -> sample.
                # HF would put a user-supplied processor *before* its warpers,
                # so we supply the warpers ourselves and keep HF's neutral.
                procs = [TemperatureLogitsWarper(sampler["temperature"]), TopKLogitsWarper(sampler["top_k"])]
                if sampler["top_p"] < 1.0:
                    procs.append(TopPLogitsWarper(sampler["top_p"]))
                if scheme == "synthid":
                    # The exact processor verified against the detector bundle,
                    # so generation and detection share one sampling table.
                    entry = self.ensure_synthid(profile)
                    proc = entry["processor"]
                    proc.state = None  # per-generation state; the object is shared with /detect
                    procs.append(proc)
                kw["logits_processor"] = LogitsProcessorList(procs)
            with torch.no_grad():
                out = model.generate(input_ids, **kw)
            new_ids = out[0, input_ids.shape[1]:]
            if scheme == "synthid":
                proc.state = None
            text = tok.decode(new_ids, skip_special_tokens=True)
            return {"ok": True, "text": text, "scheme": scheme, "key_profile": profile,
                    "tokens": int(new_ids.shape[0]), "model": self.model_id, "sampler": sampler}


def unified(detector: str, status: str, *, confidence: float | None = None, score: float | None = None,
            threshold: float | None = None, evidence: list[dict] | None = None, note: str | None = None,
            meta: dict | None = None) -> dict:
    def f(x):
        if x is None:
            return None
        x = float(x)
        return x if math.isfinite(x) else None
    return {"detector": detector, "status": status, "confidence": f(confidence), "score": f(score),
            "threshold": f(threshold), "evidence": evidence or [], "note": note,
            "requires_key": True, "requires_model": True, "local": True, "meta": meta or {}}


# ---------------------------------------------------------------- http

ENGINE: Engine | None = None
API_KEY = ""


class Handler(BaseHTTPRequestHandler):
    server_version = "unmark-stat"

    def log_message(self, fmt: str, *args: object) -> None:  # no client IPs in logs
        sys.stderr.write("%s\n" % (fmt % args))

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _err(self, status: int, msg: str) -> None:
        self._send(status, {"ok": False, "error": msg})

    def _authed(self) -> bool:
        if not API_KEY:
            return True
        return self.headers.get("Authorization", "") == f"Bearer {API_KEY}"

    def _json_body(self) -> dict | None:
        raw = self.headers.get("Content-Length", "")
        if not raw.isdigit() or int(raw) > MAX_BODY:
            self._err(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "body too large")
            return None
        try:
            data = json.loads(self.rfile.read(int(raw)).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._err(HTTPStatus.BAD_REQUEST, "invalid JSON")
            return None
        if not isinstance(data, dict):
            self._err(HTTPStatus.BAD_REQUEST, "JSON object expected")
            return None
        return data

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/health":
            if not self._authed():
                self._err(HTTPStatus.UNAUTHORIZED, "unauthorized")
                return
            self._send(HTTPStatus.OK, ENGINE.health())
            return
        self._err(HTTPStatus.NOT_FOUND, "not found")

    do_HEAD = do_GET

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path not in ("/detect", "/generate"):
            self._err(HTTPStatus.NOT_FOUND, "not found")
            return
        if not self._authed():
            self._err(HTTPStatus.UNAUTHORIZED, "unauthorized")
            return
        data = self._json_body()
        if data is None:
            return
        try:
            if path == "/detect":
                self._detect(data)
            else:
                self._generate(data)
        except Exception as e:  # noqa: BLE001
            log(f"{path} failed: {e}\n{traceback.format_exc()}")
            self._err(HTTPStatus.INTERNAL_SERVER_ERROR, f"{type(e).__name__}: {e}")

    def _detect(self, data: dict) -> None:
        text = data.get("text")
        if not isinstance(text, str) or not text.strip():
            self._err(HTTPStatus.BAD_REQUEST, "text required")
            return
        dets = data.get("detectors") or list(DETECTOR_IDS)
        if not isinstance(dets, list) or not dets or any(d not in DETECTOR_IDS for d in dets):
            self._err(HTTPStatus.BAD_REQUEST, f"detectors must be a non-empty subset of {list(DETECTOR_IDS)}")
            return
        profile = data.get("key_profile") or "a"
        if profile not in PROFILES:
            self._err(HTTPStatus.BAD_REQUEST, f"key_profile must be one of {list(PROFILES)}")
            return
        t0 = time.time()
        results = ENGINE.detect(text, dets, profile)
        log(f"detect {dets} profile={profile} chars={len(text)} -> {[r['status'] for r in results]} in {time.time() - t0:.1f}s")
        self._send(HTTPStatus.OK, {"ok": True, "results": results})

    def _generate(self, data: dict) -> None:
        if not ENGINE.allow_generate:
            self._err(HTTPStatus.FORBIDDEN, "generation disabled (--no-generate)")
            return
        prompt = data.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            self._err(HTTPStatus.BAD_REQUEST, "prompt required")
            return
        scheme = data.get("scheme") or "none"
        if scheme not in ("kgw", "synthid", "none"):
            self._err(HTTPStatus.BAD_REQUEST, "scheme must be kgw, synthid or none")
            return
        profile = data.get("key_profile") or "a"
        if profile not in PROFILES:
            self._err(HTTPStatus.BAD_REQUEST, f"key_profile must be one of {list(PROFILES)}")
            return
        try:
            n = int(data.get("max_new_tokens") or 400)
        except (TypeError, ValueError):
            self._err(HTTPStatus.BAD_REQUEST, "max_new_tokens must be an integer")
            return
        n = max(1, min(MAX_NEW_TOKENS, n))
        t0 = time.time()
        out = ENGINE.generate(prompt, scheme, profile, n)
        log(f"generate scheme={scheme} profile={profile} -> {out['tokens']} tokens in {time.time() - t0:.1f}s")
        self._send(HTTPStatus.OK, out)


def main() -> int:
    global ENGINE, API_KEY
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--port", type=int, default=int(os.environ.get("UNMARK_STAT_PORT", "8767")))
    p.add_argument("--api-key", default=os.environ.get("UNMARK_STAT_API_KEY", ""),
                   help="if set, every request must carry Authorization: Bearer <key>")
    p.add_argument("--model", default=os.environ.get("UNMARK_STAT_MODEL", DEFAULT_MODEL))
    p.add_argument("--device", default=os.environ.get("UNMARK_STAT_DEVICE", "auto"), help="auto | cuda | cpu | cuda:N")
    p.add_argument("--no-generate", action="store_true", help="disable POST /generate")
    p.add_argument("--preload", action="store_true", help="load model and detectors at startup instead of on first use")
    a = p.parse_args()
    API_KEY = a.api_key
    ENGINE = Engine(a.model, a.device, not a.no_generate)
    if a.preload:
        ENGINE.ensure_model()
        for prof in PROFILES:
            ENGINE.ensure_kgw(prof)
            if prof in ENGINE.synthid_keys:
                ENGINE.ensure_synthid(prof)
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    log(f"unmark-stat on http://127.0.0.1:{a.port}/  model={a.model} device={a.device} "
        f"generate={'on' if not a.no_generate else 'off'} auth={'bearer' if API_KEY else 'none'}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
