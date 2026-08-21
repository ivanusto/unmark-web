"""Cross-engine parity: js/gumbel.js must match upstream detect_gumbel.py.

The keyed-Gumbel replay test is pure arithmetic over HMAC-SHA256, so the two
engines have to agree to the last bit. Requires `node` and an upstream checkout
(WATERMARKS_UPSTREAM_DIR, default ../watermarks-remover). Skips cleanly when
either is missing.
"""
from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
UPSTREAM = Path(os.environ.get("WATERMARKS_UPSTREAM_DIR", ROOT.parent / "watermarks-remover"))
SCRIPTS = UPSTREAM / "service" / "scripts"
NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(
    NODE is None or not (SCRIPTS / "detect_gumbel.py").is_file(),
    reason="needs node and an upstream checkout (WATERMARKS_UPSTREAM_DIR)",
)

if (SCRIPTS / "detect_gumbel.py").is_file():
    sys.path.insert(0, str(SCRIPTS))
    import detect_gumbel  # type: ignore  # noqa: E402

TEXTS = [
    "",
    "one two three",
    "the quick brown fox jumps over the lazy dog and then runs away fast",
    "Punctuation, Digits 42 and MiXeD Case -- the tokenizer folds all of it.",
    # Every window recurs after the first pass, so repeated-window masking has
    # to skip almost everything; a detector that forgot the mask would score
    # this as overwhelming evidence.
    "spam spam spam spam spam spam spam spam spam spam spam spam",
    "unicode אבג 中文 tokens survive the simple tokenizer as separators",
]
KEYS = ["hunter2", "0xdeadbeef", "0x00", "a longer passphrase with spaces"]
WINDOWS = [1, 4, 8]

# Ids that straddle the 2**53 boundary, where a naive float round trip loses
# the low bits and the whole statistic drifts.
BIG_IDS = [0, 1, 2**53 - 1, 2**53, 2**53 + 1, 2**64 - 1, 12345678901234567890]


def _js(req: dict) -> dict:
    proc = subprocess.run(
        [NODE, str(ROOT / "tests" / "gumbel_cli.js")],
        input=json.dumps(req), capture_output=True, text=True, check=True,
    )
    return json.loads(proc.stdout)


def _assert_same(js: dict, py: dict, ctx) -> None:
    assert "error" not in js, (js, ctx)
    for field in ("detector", "scheme", "vendor", "available", "window", "threshold",
                  "tokens_total", "skipped_no_context", "skipped_repeated", "counted",
                  "is_watermarked", "note"):
        assert js[field] == py[field], (field, js[field], py[field], ctx)
    assert ("statistic" in js) == ("statistic" in py), ctx
    if "statistic" in py:
        # Python's round(x, 6) and JS toFixed(6) differ only on exact decimal
        # ties, which a sum of logarithms does not produce; compare with a
        # tolerance rather than pinning a rounding mode neither engine promises.
        assert math.isclose(js["statistic"], py["statistic"], rel_tol=1e-12, abs_tol=1e-9), ctx
        assert math.isclose(js["score"], py["score"], rel_tol=1e-12, abs_tol=1e-9), ctx
    else:
        assert js["score"] == py["score"], ctx
    assert math.isclose(js["p_value"], py["p_value"], rel_tol=1e-12, abs_tol=0.0), (
        js["p_value"], py["p_value"], ctx)


@pytest.mark.parametrize("text", TEXTS)
@pytest.mark.parametrize("key", KEYS)
@pytest.mark.parametrize("window", WINDOWS)
def test_text_parity(text: str, key: str, window: int) -> None:
    py = detect_gumbel.detect_text(text, key, window=window)
    js = _js({"mode": "text", "text": text, "key": key, "options": {"window": window}})
    _assert_same(js, py, (text, key, window))


def test_tokenizer_parity() -> None:
    for text in TEXTS:
        py = detect_gumbel.tokenize_simple(text)
        js = _js({"mode": "tokens", "tokens": [str(t) for t in py], "key": "k"})
        assert js["tokens_total"] == len(py), text


@pytest.mark.parametrize("key", ["k", "0xfeedface"])
def test_token_id_parity(key: str) -> None:
    """Explicit ids, including values above 2**53 and at the 64-bit ceiling."""
    ids = BIG_IDS + BIG_IDS[::-1] + BIG_IDS
    py = detect_gumbel.detect_token_ids(ids, key, window=2)
    js = _js({"mode": "tokens", "tokens": [str(i) for i in ids], "key": key, "options": {"window": 2}})
    _assert_same(js, py, (key, "big ids"))
    assert py["counted"] > 0 and py["skipped_repeated"] > 0


def test_threshold_flips_the_verdict() -> None:
    """A verdict is a threshold comparison, so both engines must move together."""
    text = TEXTS[2]
    py_low = detect_gumbel.detect_text(text, "k", threshold=1e-9)
    py_high = detect_gumbel.detect_text(text, "k", threshold=0.999999)
    assert py_low["is_watermarked"] != py_high["is_watermarked"]
    for py, thr in ((py_low, 1e-9), (py_high, 0.999999)):
        js = _js({"mode": "text", "text": text, "key": "k", "options": {"threshold": thr}})
        _assert_same(js, py, thr)


def test_detects_a_forged_winner_sequence() -> None:
    """True-positive check: no sampler here, so forge the winners directly.

    For each position pick the candidate id that maximises the keyed uniform.
    That is what a keyed-Gumbel sampler does, so the replay must light up under
    the same key and fall back to chance under a different one.
    """
    key, other, window = "the-generation-key", "some-other-key", 4
    key_bytes = detect_gumbel._normalize_key(key)
    ids = [1, 2, 3, 4]
    for _ in range(60):
        seed = detect_gumbel._seed(key_bytes, tuple(ids[-window:]))
        best = max(range(1000), key=lambda c: detect_gumbel._uniform(seed, c))
        ids.append(best)

    hot = detect_gumbel.detect_token_ids(ids, key, window=window)
    cold = detect_gumbel.detect_token_ids(ids, other, window=window)
    assert hot["is_watermarked"] and hot["p_value"] < 1e-12, hot
    assert not cold["is_watermarked"] and cold["p_value"] > 1e-3, cold

    for k, py in ((key, hot), (other, cold)):
        js = _js({"mode": "tokens", "tokens": [str(i) for i in ids], "key": k,
                  "options": {"window": window}})
        _assert_same(js, py, k)


@pytest.mark.parametrize("bad_key", ["0x", "0xabc", "0xzz"])
def test_bad_hex_key_rejected_by_both(bad_key: str) -> None:
    with pytest.raises(ValueError):
        detect_gumbel.detect_text("hello world", bad_key)
    js = _js({"mode": "text", "text": "hello world", "key": bad_key})
    assert "error" in js and "hex" in js["error"], js


@pytest.mark.parametrize("opts", [{"window": 0}, {"threshold": 0.0}, {"threshold": 1.0}])
def test_bad_options_rejected_by_both(opts: dict) -> None:
    with pytest.raises(ValueError):
        detect_gumbel.detect_text("hello world", "k", **opts)
    js = _js({"mode": "text", "text": "hello world", "key": "k", "options": opts})
    assert "error" in js, js
