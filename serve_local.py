#!/usr/bin/env python3
"""Serve this web UI on loopback and proxy to local services — so the browser
talks same-origin and no CORS changes are needed.

    /api/*  -> a running watermarks-remover server.py
    /llm/*  -> an OpenAI-compatible chat endpoint, for the optional AI rewrite

    python3 serve_local.py                       # UI on http://127.0.0.1:8766, proxies to http://127.0.0.1:8765
    python3 serve_local.py --upstream http://127.0.0.1:8765 --api-key "$KEY"
    python3 serve_local.py --llm-upstream http://<your-llm-host>:<port> --llm-model <model>

The rewrite proxy is off unless --llm-upstream (or UNMARK_LLM_URL) is set; with
it unset, /llm/* answers 404 and the UI hides the rewrite panel entirely. The
LLM key never reaches the browser: it is injected here, server-side.

Stdlib only. Binds 127.0.0.1 only. Static files are served from this directory
with an allow-list (index.html, favicon.svg, css/, js/) — no directory listing,
no path traversal.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
import urllib.error
import urllib.request
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
ALLOWED = {"/": ROOT / "index.html", "/index.html": ROOT / "index.html", "/favicon.svg": ROOT / "favicon.svg"}
for sub in ("css", "js"):
    for f in (ROOT / sub).glob("*"):
        if f.is_file():
            ALLOWED[f"/{sub}/{f.name}"] = f
MAX_PROXY_BODY = 512 << 20
UPSTREAM = "http://127.0.0.1:8765"
API_KEY = ""
# Rewrite proxy. Empty upstream = feature off; no default host is baked in so
# nothing about a private network ends up in this repo.
LLM_UPSTREAM = ""
LLM_API_KEY = ""
LLM_MODEL = ""
FILE_TIMEOUT = 600  # file cleaning can be slow on big inputs
LLM_TIMEOUT = 300


class Handler(BaseHTTPRequestHandler):
    server_version = "unmark-web/serve_local"

    def log_message(self, fmt: str, *args: object) -> None:  # quieter, no client IPs in logs
        sys.stderr.write("%s\n" % (fmt % args))

    def _send(self, status: int, body: bytes, ctype: str, extra: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _static(self, path: str) -> None:
        f = ALLOWED.get(path)
        if f is None or not f.is_file():
            self._send(HTTPStatus.NOT_FOUND, b"not found", "text/plain; charset=utf-8")
            return
        ctype = mimetypes.guess_type(str(f))[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "image/svg+xml"):
            ctype += "; charset=utf-8"
        self._send(HTTPStatus.OK, f.read_bytes(), ctype)

    def _route(self, path: str) -> tuple[str, str, str, int] | None:
        """(prefix, upstream, api_key, timeout) for a proxied path, else None."""
        if path.startswith("/api/"):
            return ("/api", UPSTREAM, API_KEY, FILE_TIMEOUT)
        if path.startswith("/llm/"):
            return ("/llm", LLM_UPSTREAM, LLM_API_KEY, LLM_TIMEOUT)
        return None

    def _proxy(self, path: str, prefix: str, upstream: str, api_key: str, timeout: int) -> None:
        if not upstream:
            self._send(HTTPStatus.NOT_FOUND, b'{"ok":false,"error":"proxy not configured"}', "application/json")
            return
        target = upstream + path[len(prefix):]
        body = None
        if self.command == "POST":
            raw = self.headers.get("Content-Length", "")
            if not raw.isdigit() or int(raw) > MAX_PROXY_BODY:
                self._send(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, b'{"ok":false,"error":"body too large"}', "application/json")
                return
            body = self.rfile.read(int(raw))
        headers = {"Content-Type": self.headers.get("Content-Type", "application/json")}
        # /api lets the page supply its own bearer token; /llm never does — its
        # key is configured here so it stays out of the browser entirely.
        if prefix == "/llm":
            auth = f"Bearer {api_key}" if api_key else ""
        else:
            auth = self.headers.get("Authorization") or (f"Bearer {api_key}" if api_key else "")
        if auth:
            headers["Authorization"] = auth
        req = urllib.request.Request(target, data=body, method=self.command, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                self._send(resp.status, resp.read(), resp.headers.get("Content-Type", "application/json"))
        except urllib.error.HTTPError as e:
            self._send(e.code, e.read(), e.headers.get("Content-Type", "application/json"))
        except (urllib.error.URLError, OSError) as e:
            msg = ('{"ok":false,"error":"upstream unreachable: %s"}' % str(e.reason if hasattr(e, "reason") else e).replace('"', "'")).encode()
            self._send(HTTPStatus.BAD_GATEWAY, msg, "application/json")

    def _llm_config(self) -> None:
        """What the UI needs to decide whether to show the rewrite panel.

        Deliberately does not echo the upstream URL or the key.
        """
        payload = {"ok": True, "enabled": bool(LLM_UPSTREAM), "model": LLM_MODEL}
        self._send(HTTPStatus.OK, json.dumps(payload).encode(), "application/json")

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/llm-config":
            self._llm_config()
            return
        route = self._route(path)
        if route:
            self._proxy(path, *route)
        else:
            self._static(path)

    do_HEAD = do_GET

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        route = self._route(path)
        if route:
            self._proxy(path, *route)
        else:
            self._send(HTTPStatus.NOT_FOUND, b"not found", "text/plain; charset=utf-8")


def main() -> int:
    global UPSTREAM, API_KEY, LLM_UPSTREAM, LLM_API_KEY, LLM_MODEL
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--port", type=int, default=int(os.environ.get("WMWEB_PORT", "8766")))
    p.add_argument("--upstream", default=os.environ.get("WATERMARKS_SERVICE_URL", UPSTREAM))
    p.add_argument("--api-key", default=os.environ.get("WATERMARKS_SERVER_API_KEY", ""))
    p.add_argument("--llm-upstream", default=os.environ.get("UNMARK_LLM_URL", ""),
                   help="OpenAI-compatible base URL for the optional AI rewrite, without the /v1 suffix")
    p.add_argument("--llm-api-key", default=os.environ.get("UNMARK_LLM_API_KEY", ""))
    p.add_argument("--llm-model", default=os.environ.get("UNMARK_LLM_MODEL", ""))
    a = p.parse_args()
    UPSTREAM, API_KEY = a.upstream.rstrip("/"), a.api_key
    LLM_UPSTREAM, LLM_API_KEY, LLM_MODEL = a.llm_upstream.rstrip("/"), a.llm_api_key, a.llm_model
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    print(f"web UI: http://127.0.0.1:{a.port}/  (proxying /api -> {UPSTREAM})", file=sys.stderr)
    print(f"AI rewrite: {'/llm -> ' + LLM_UPSTREAM if LLM_UPSTREAM else 'disabled (--llm-upstream unset)'}", file=sys.stderr)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
