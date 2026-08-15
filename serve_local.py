#!/usr/bin/env python3
"""Serve this web UI on loopback and proxy /api/* to a running watermarks-remover
server.py — so the browser talks same-origin and no CORS changes are needed.

    python3 serve_local.py                       # UI on http://127.0.0.1:8766, proxies to http://127.0.0.1:8765
    python3 serve_local.py --upstream http://127.0.0.1:8765 --api-key "$KEY"

Stdlib only. Binds 127.0.0.1 only. Static files are served from this directory
with an allow-list (index.html, favicon.svg, css/, js/) — no directory listing,
no path traversal.
"""
from __future__ import annotations

import argparse
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


class Handler(BaseHTTPRequestHandler):
    server_version = "watermarks-remover-web/serve_local"

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

    def _proxy(self, path: str) -> None:
        if not path.startswith("/api/"):
            self._send(HTTPStatus.NOT_FOUND, b"not found", "text/plain; charset=utf-8")
            return
        target = UPSTREAM + path[len("/api"):]
        body = None
        if self.command == "POST":
            raw = self.headers.get("Content-Length", "")
            if not raw.isdigit() or int(raw) > MAX_PROXY_BODY:
                self._send(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, b'{"ok":false,"error":"body too large"}', "application/json")
                return
            body = self.rfile.read(int(raw))
        headers = {"Content-Type": self.headers.get("Content-Type", "application/json")}
        auth = self.headers.get("Authorization") or (f"Bearer {API_KEY}" if API_KEY else "")
        if auth:
            headers["Authorization"] = auth
        req = urllib.request.Request(target, data=body, method=self.command, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=600) as resp:
                self._send(resp.status, resp.read(), resp.headers.get("Content-Type", "application/json"))
        except urllib.error.HTTPError as e:
            self._send(e.code, e.read(), e.headers.get("Content-Type", "application/json"))
        except (urllib.error.URLError, OSError) as e:
            msg = ('{"ok":false,"error":"upstream unreachable: %s"}' % str(e.reason if hasattr(e, "reason") else e).replace('"', "'")).encode()
            self._send(HTTPStatus.BAD_GATEWAY, msg, "application/json")

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            self._proxy(path)
        else:
            self._static(path)

    do_HEAD = do_GET

    def do_POST(self) -> None:  # noqa: N802
        self._proxy(urlparse(self.path).path)


def main() -> int:
    global UPSTREAM, API_KEY
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--port", type=int, default=int(os.environ.get("WMWEB_PORT", "8766")))
    p.add_argument("--upstream", default=os.environ.get("WATERMARKS_SERVICE_URL", UPSTREAM))
    p.add_argument("--api-key", default=os.environ.get("WATERMARKS_SERVER_API_KEY", ""))
    a = p.parse_args()
    UPSTREAM, API_KEY = a.upstream.rstrip("/"), a.api_key
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    print(f"web UI: http://127.0.0.1:{a.port}/  (proxying /api -> {UPSTREAM})", file=sys.stderr)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
