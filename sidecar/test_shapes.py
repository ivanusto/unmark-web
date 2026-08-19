"""Shape/validation tests for sidecar/unmark_stat.py that need neither torch nor a model.

The module imports torch/transformers lazily, so the HTTP layer, request
validation and the UnifiedResult shape can be exercised with a stub engine.
"""
from __future__ import annotations

import json
import sys
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import unmark_stat as us  # noqa: E402

UNIFIED_KEYS = {"detector", "status", "confidence", "score", "threshold", "evidence", "note",
                "requires_key", "requires_model", "local", "meta"}


class StubEngine:
    allow_generate = True
    model_id = "stub"

    def health(self):
        return {"ok": True, "device": "cpu", "model": "stub", "loaded": False, "generate": True, "detectors": []}

    def detect(self, text, detectors, profile):
        return [us.unified(d, "uncertain", note="stub", meta={"key_profile": profile, "tokens": len(text)}) for d in detectors]

    def generate(self, prompt, scheme, profile, n):
        return {"ok": True, "text": prompt[::-1], "scheme": scheme, "key_profile": profile, "tokens": n,
                "model": "stub", "sampler": {}}


@pytest.fixture(scope="module")
def server():
    us.ENGINE = StubEngine()
    us.API_KEY = "secret"
    srv = ThreadingHTTPServer(("127.0.0.1", 0), us.Handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def call(base, method, path, body=None, auth="secret"):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if auth:
        headers["Authorization"] = f"Bearer {auth}"
    req = urllib.request.Request(base + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read()), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read()), dict(e.headers)


def test_unified_shape():
    r = us.unified("kgw", "clean", confidence=0.5, score=float("nan"))
    assert set(r) == UNIFIED_KEYS
    assert r["score"] is None  # NaN never reaches JSON
    assert r["requires_key"] and r["requires_model"] and r["local"]


def test_health_and_headers(server):
    status, body, hdrs = call(server, "GET", "/health")
    assert status == 200 and body["ok"] is True
    assert hdrs.get("X-Content-Type-Options") == "nosniff"
    assert hdrs.get("Cache-Control") == "no-store"


def test_auth_required(server):
    status, body, _ = call(server, "GET", "/health", auth=None)
    assert status == 401 and body["ok"] is False
    status, body, _ = call(server, "POST", "/detect", {"text": "x"}, auth="wrong")
    assert status == 401


def test_detect_validation_and_shape(server):
    status, body, _ = call(server, "POST", "/detect", {"text": ""})
    assert status == 400 and body["ok"] is False
    status, body, _ = call(server, "POST", "/detect", {"text": "hi", "detectors": ["nope"]})
    assert status == 400
    status, body, _ = call(server, "POST", "/detect", {"text": "hi", "key_profile": "z"})
    assert status == 400
    status, body, _ = call(server, "POST", "/detect", {"text": "hello", "key_profile": "b"})
    assert status == 200 and body["ok"] is True
    assert [r["detector"] for r in body["results"]] == list(us.DETECTOR_IDS)
    assert all(set(r) == UNIFIED_KEYS for r in body["results"])
    assert body["results"][0]["meta"]["key_profile"] == "b"


def test_generate_validation_and_clamp(server):
    status, body, _ = call(server, "POST", "/generate", {"prompt": "abc", "scheme": "bad"})
    assert status == 400
    status, body, _ = call(server, "POST", "/generate", {"prompt": "abc", "scheme": "kgw", "max_new_tokens": 99999})
    assert status == 200 and body["tokens"] == us.MAX_NEW_TOKENS and body["text"] == "cba"


def test_unknown_and_bad_json(server):
    status, body, _ = call(server, "GET", "/nope")
    assert status == 404 and body["ok"] is False
    req = urllib.request.Request(server + "/detect", data=b"{not json", method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer secret"})
    with pytest.raises(urllib.error.HTTPError) as ei:
        urllib.request.urlopen(req, timeout=5)
    assert ei.value.code == 400


def test_key_files_present_and_consistent():
    for p in us.PROFILES:
        f = us.KEYS_DIR / f"key-{p}.json"
        assert f.is_file(), f
        cfg = json.loads(f.read_text())["config"]
        assert cfg["ngram_len"] == 5 and len(cfg["keys"]) == 30 and cfg["sampling_table_size"] == 65536
