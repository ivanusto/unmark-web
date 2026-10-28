"""serve_local.py: allow-list, --llm-extra merge, key isolation, /llm-config, arg parsing."""
from __future__ import annotations

import json
import sys
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import ipaddress
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import serve_local as sl  # noqa: E402

SECRET = "sk-server-secret"


@pytest.fixture()
def stack(monkeypatch):
    seen: list[dict] = []

    class Fake(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            n = int(self.headers.get("Content-Length", "0"))
            seen.append({"path": self.path, "headers": dict(self.headers), "body": self.rfile.read(n)})
            out = b'{"ok":true}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)

    up = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
    web = ThreadingHTTPServer(("127.0.0.1", 0), sl.Handler)
    for srv in (up, web):
        threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setattr(sl, "LLM_UPSTREAM", f"http://127.0.0.1:{up.server_address[1]}")
    monkeypatch.setattr(sl, "LLM_API_KEY", SECRET)
    monkeypatch.setattr(sl, "LLM_MODEL", "m1")
    monkeypatch.setattr(sl, "LLM_TIMEOUT", 42)
    monkeypatch.setattr(sl, "LLM_EXTRA", {})
    monkeypatch.setattr(sl, "ALLOW", [])
    base = f"http://127.0.0.1:{web.server_address[1]}"
    yield base, seen
    up.shutdown(); web.shutdown(); up.server_close(); web.server_close()


def post(base, path, data: bytes, headers=None):
    h = {"Content-Type": "application/json", **(headers or {})}
    with urllib.request.urlopen(urllib.request.Request(base + path, data=data, headers=h), timeout=10) as r:
        return r.status, r.read()


CHAT = "/llm/v1/chat/completions"


def test_client_allowed(monkeypatch):
    monkeypatch.setattr(sl, "ALLOW", [])
    assert sl._client_allowed("203.0.113.9")
    monkeypatch.setattr(sl, "ALLOW", [ipaddress.ip_network("192.0.2.0/24"), ipaddress.ip_network("2001:db8::/32")])
    assert sl._client_allowed("192.0.2.77")
    assert not sl._client_allowed("198.51.100.1")
    assert sl._client_allowed("2001:db8::5")
    assert not sl._client_allowed("2001:db9::5")
    assert sl._client_allowed("::ffff:192.0.2.5")
    assert not sl._client_allowed("::ffff:198.51.100.5")
    assert sl._client_allowed("127.0.0.1") and sl._client_allowed("::1") and sl._client_allowed("::ffff:127.0.0.1")
    assert not sl._client_allowed("not-an-ip")


def test_denied_end_to_end(stack, monkeypatch):
    base, seen = stack
    monkeypatch.setattr(sl, "_client_allowed", lambda ip: False)
    for method, path in (("GET", "/"), ("HEAD", "/"), ("GET", "/llm-config"), ("POST", CHAT)):
        req = urllib.request.Request(base + path, data=b"{}" if method == "POST" else None, method=method)
        with pytest.raises(urllib.error.HTTPError) as ei:
            urllib.request.urlopen(req, timeout=10)
        assert ei.value.code == 403
        assert ei.value.headers["Content-Type"].startswith("text/plain")
        if method != "HEAD":
            assert ei.value.read() == b"forbidden"
    assert seen == []


def test_extra_merge(stack, monkeypatch):
    base, seen = stack
    monkeypatch.setattr(sl, "LLM_EXTRA", {"max_tokens": 99, "chat_template_kwargs": {"enable_thinking": False}})
    body = {"model": "x", "max_tokens": 5, "chat_template_kwargs": {"a": 1, "enable_thinking": True}}
    post(base, CHAT, json.dumps(body).encode())
    got = json.loads(seen[-1]["body"])
    assert got["max_tokens"] == 99 and got["model"] == "x"
    assert got["chat_template_kwargs"] == {"a": 1, "enable_thinking": False}
    assert int(seen[-1]["headers"]["Content-Length"]) == len(seen[-1]["body"])
    assert seen[-1]["path"] == "/v1/chat/completions"


def test_non_json_unchanged_and_other_paths(stack, monkeypatch):
    base, seen = stack
    monkeypatch.setattr(sl, "LLM_EXTRA", {"max_tokens": 99})
    post(base, CHAT, b"not json{")
    assert seen[-1]["body"] == b"not json{"
    post(base, "/llm/v1/other", b'{"a":1}')
    assert seen[-1]["body"] == b'{"a":1}'


def test_browser_auth_not_forwarded(stack):
    base, seen = stack
    post(base, CHAT, b"{}", {"Authorization": "Bearer browser-token"})
    assert seen[-1]["headers"]["Authorization"] == f"Bearer {SECRET}"


def test_llm_config(stack):
    base, _ = stack
    with urllib.request.urlopen(base + "/llm-config", timeout=10) as r:
        raw = r.read().decode()
    cfg = json.loads(raw)
    assert cfg["enabled"] is True and cfg["model"] == "m1" and cfg["timeout"] == 42
    assert SECRET not in raw and "127.0.0.1" not in raw and "http" not in raw


def test_arg_parsing(monkeypatch):
    for k in ("UNMARK_ALLOW", "UNMARK_LLM_EXTRA", "UNMARK_HOST"):
        monkeypatch.delenv(k, raising=False)
    a = sl.parse_args(["--allow", "192.0.2.0/24, 198.51.100.7", "--llm-extra", '{"k":{"v":1}}', "--llm-timeout", "7"])
    assert [str(n) for n in a.allow] == ["192.0.2.0/24", "198.51.100.7/32"]
    assert a.llm_extra == {"k": {"v": 1}} and a.llm_timeout == 7 and a.host == "127.0.0.1"
    d = sl.parse_args([])
    assert d.allow == [] and d.llm_extra == {} and d.llm_timeout == 300
    for bad in (["--allow", "300.1.1.1/8"], ["--allow", "nope"], ["--llm-extra", "[1]"], ["--llm-extra", "{bad"]):
        with pytest.raises(SystemExit):
            sl.parse_args(bad)
    monkeypatch.setenv("UNMARK_ALLOW", "bogus")
    with pytest.raises(SystemExit):
        sl.parse_args([])
