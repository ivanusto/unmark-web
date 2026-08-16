# watermarks-remover-web

[English](README.md) · [繁體中文](README.zh-TW.md)

Independent, browser-first web client for **[guillaumemeyer/watermarks-remover](https://github.com/guillaumemeyer/watermarks-remover)** — inspired by and compatible with its HTTP API. Not affiliated with the upstream project.

- **Runs entirely in the browser** for text (Layer A: invisible Unicode / homoglyph spaces) and PNG / JPEG / WebP / AVIF / HEIC metadata (C2PA, EXIF, XMP, text chunks). No uploads, no analytics, no web fonts, no third-party requests.
- **Optionally drives the upstream Python service** (`server.py`) for everything else — PDF, DOCX, ODT, full HTML/SVG/Markdown container cleaning, and pixel-domain backends.
- The JavaScript engines are **line-for-line ports of upstream's `text_unicode.py` and `image_meta.py`**, and a parity test suite asserts identical output (same characters kept/stripped, same bytes out of the image parsers).

Live demo: [https://ivanusto.github.io/watermarks-remover-web/](https://ivanusto.github.io/watermarks-remover-web/) · Local: open `index.html` or run `python3 serve_local.py`.

## What it does (and does not)

| Input | Browser engine | Server engine (`server.py`) |
| --- | --- | --- |
| Pasted text / `.txt` | Layer A: zero-width & bidi controls, variation selectors, tag chars, PUA, other `Cf`; space homoglyphs; optional NFKC / Latin confusables. Preserves load-bearing invisibles (emoji ZWJ/VS16, Persian/Indic ZWNJ, flag tags, Mongolian FVS, Khmer vowels, Hangul fillers, Arabic Cf) exactly like upstream, with a "paranoid" toggle. | same |
| `.md` `.html` `.svg` | Layer A on the text only (metadata tags/frontmatter untouched — flagged in the UI) | full container cleaning (frontmatter keys, `<meta generator>`, XMP, …) |
| PNG / JPEG / WebP / AVIF / HEIC | drops `tEXt/zTXt/iTXt/eXIf/caBX/c2*` chunks, `APPn` (except JFIF) + `COM` segments, `EXIF/XMP/ICCP/C2PA` RIFF chunks with VP8X flag fix-up, and `jumb/c2pa/uuid` (XMP) ISOBMFF boxes plus their `meta` sub-boxes. Pixels are untouched (no canvas re-encode). "Keep non-AI metadata" mode only drops blocks with AI/C2PA hints. | same, plus optional pixel-domain backends if installed |
| PDF / DOCX / ODT | — (needs server) | yes |
| Statistical / pixel watermarks (SynthID, …) | **no** — out of scope for both; see upstream Layer B | via upstream backends only |

## Connecting a server

`server.py` binds to `127.0.0.1:8765`, sends **no CORS headers**, and may require a bearer token — by design. Three ways to use it from this UI:

1. **`serve_local.py` (recommended)** — stdlib, loopback-only static server that proxies `/api/*` to `server.py`, so the browser talks same-origin:
   ```bash
   # terminal 1: upstream service
   python3 service/scripts/server.py                     # from the upstream checkout (or its Docker image)
   # terminal 2: this UI
   python3 serve_local.py --upstream http://127.0.0.1:8765 [--api-key "$WATERMARKS_SERVER_API_KEY"]
   # open http://127.0.0.1:8766/  → the UI auto-selects /api
   ```
2. **Any reverse proxy** that serves this directory and forwards a path to `server.py`; enter that path (e.g. `/api`) or URL in ⚙️ *Server connection*.
3. **Direct URL** (e.g. from the GitHub Pages build) — only works if something in front of the server allows this page's origin via CORS. Upstream deliberately ships **no** CORS support in `server.py` (the API is meant to be server-to-server; see [issue #77](https://github.com/guillaumemeyer/watermarks-remover/issues/77) and [PR #78](https://github.com/guillaumemeyer/watermarks-remover/pull/78)), so this means your own reverse proxy in front of it. Do **not** put a wildcard CORS header on the API.

The API key is only sent as `Authorization: Bearer …` to the URL you configured, and only stored in `localStorage` if you tick *Remember in this browser*.

## Development

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
git clone https://github.com/guillaumemeyer/watermarks-remover ../watermarks-remover     # for parity tests
WATERMARKS_UPSTREAM_DIR=../watermarks-remover .venv/bin/pytest -q
node scripts/check-upstream.mjs                                                          # upstream hash drift
```

There is no `package.json` here — nothing at runtime or in the test suite needs npm, so the upstream check runs straight through `node`, exactly as [the workflow](.github/workflows/upstream-check.yml) does. It exits `0` when the recorded hashes still match, `1` on drift, and `2` when it could not check at all (network, rate limit, bad manifest) — an unreachable source is never reported as drift.

- `js/layer_a.js` — port of `text_unicode.py` (`clean`, `inspect`, `decide`)
- `js/image_meta.js` — port of `image_meta.py` (PNG/JPEG/WebP/AVIF/HEIC inspect + strip)
- `js/api.js` — client for `/health /capabilities /inspect /clean`
- `js/i18n.js`, `js/app.js`, `css/app.css`, `index.html` — UI (English / 繁體中文 / 简体中文, light/dark, keyboard-accessible). The locale is picked from `navigator.languages` and remembered in `localStorage`; adding a language is one entry in `LANGS` plus one dictionary in `js/i18n.js`.
- `tests/test_layer_a_parity.py`, `tests/test_image_meta_parity.py` — cross-engine parity vs the upstream checkout (skipped if `node` or the checkout is missing)
- `serve_local.py` — same-origin static + `/api` proxy
- `scripts/check-upstream.mjs` — run it with `node scripts/check-upstream.mjs`; hashes the upstream Python modules against `scripts/upstream-sources.json`; `.github/workflows/upstream-check.yml` runs it and the parity suite daily and files an issue when either signal fires. Parity catches behaviour that changed; the hashes catch changes the fixtures do not reach, such as a newly supported format.

No build step, no dependencies at runtime. CSP: `default-src 'self'; connect-src *` (the latter so you can point at your own server).

## Attribution & license

MIT — see [LICENSE](LICENSE). The character tables, decision rules and container parsers are derived from watermarks-remover, © watermarks-remover contributors, MIT; the upstream notice is preserved in [NOTICE](NOTICE). Use on content you own or are authorised to modify — see upstream's [ethics notes](https://github.com/guillaumemeyer/watermarks-remover/blob/main/skills/remove-ai-marks/references/ethics.md).
