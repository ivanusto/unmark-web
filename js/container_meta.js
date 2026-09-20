/*
 * Container metadata: the text-markup half of upstream's `container_meta.py`.
 *
 * Faithful JavaScript port of the SVG, embedded-data-URI, HTML and Markdown
 * paths of `service/scripts/container_meta.py` from
 * guillaumemeyer/watermarks-remover (MIT). The rest of that file is ZIP
 * (DOCX/XLSX/PPTX/ODT/EPUB) and PDF work built on zipfile, zlib, tempfiles and
 * external tools, none of which a page has; scripts/upstream-sources.json
 * tracks the ported definitions one slice at a time and records the rest as
 * deliberately absent.
 *
 * Two Python behaviours had to be built rather than borrowed, because getting
 * either one approximately right changes the bytes that come out:
 *
 *  - `bytes.decode("utf-8", errors=...)`. clean_svg decodes with
 *    `surrogateescape` and re-encodes at the end, so a file that is not valid
 *    UTF-8 survives byte for byte; inspect_svg decodes with `replace`, which
 *    emits one U+FFFD per invalid subpart rather than one per byte. Neither is
 *    what TextDecoder does, so both are written out here.
 *  - `base64.b64decode` and `urllib.parse.quote_from_bytes`. CPython's base64
 *    ignores characters outside the alphabet (a data URI payload may carry a
 *    stray `%`), treats `=` as a terminator only once a quantum is short, and
 *    raises on the two padding shapes it cannot complete. quote_from_bytes
 *    leaves `/` unescaped and escapes `!'()*`, where encodeURIComponent does
 *    the opposite of both.
 *
 * Python `re` and `str` semantics come from js/pyre.js.
 *
 * Works as a plain <script> (exposes window.ContainerMeta) and as a CommonJS
 * module.
 */
(function (root) {
  "use strict";

  const IM = (typeof module !== "undefined" && module.exports)
    ? require("./image_meta.js")
    : root.ImageMeta;
  const PyRe = (typeof module !== "undefined" && module.exports)
    ? require("./pyre.js")
    : root.PyRe;
  const { compilePy, pyIsAlnum, pyIsSpace } = PyRe;

  /* compilePy returns a global regex (the marker scans it was written for use
   * matchAll), so a bare .test() would walk lastIndex forward between calls.
   * Every re.search() site goes through here instead. */
  function search(re, s) {
    re.lastIndex = 0;
    return re.test(s);
  }

  // ---- bytes <-> str ----------------------------------------------------

  /**
   * bytes.decode("utf-8", errors=mode) for mode "surrogateescape" or
   * "replace". Invalid input is reported the way CPython reports it: the
   * maximal valid prefix of a broken sequence is consumed, and the handler
   * sees exactly those bytes, so "replace" yields one U+FFFD for the whole
   * run while "surrogateescape" yields one lone surrogate per byte.
   */
  const TD_STRICT = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }) : null;
  const TE = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  const RE_LONE_SURROGATE = /\p{Surrogate}/u;

  function decodeUtf8(u8, mode) {
    /* Fast path. TextDecoder in fatal mode succeeds only when the whole input
     * is well-formed UTF-8, and well-formed input never reaches either error
     * handler, so both modes agree with it and with each other. ignoreBOM is
     * not optional: without it TextDecoder swallows a leading U+FEFF, and
     * bytes.decode() in Python does not. Anything invalid throws and falls
     * through to the scanner below, which is where CPython's exact reporting
     * of a broken sequence lives. */
    if (TD_STRICT) {
      try { return TD_STRICT.decode(u8); } catch (_) { /* not valid UTF-8 */ }
    }
    let out = "";
    let i = 0;
    const n = u8.length;
    const bad = (start, end) => {
      if (mode === "replace") { out += "\uFFFD"; return; }
      for (let k = start; k < end; k++) out += String.fromCharCode(0xdc00 + u8[k]);
    };
    while (i < n) {
      const b = u8[i];
      if (b < 0x80) { out += String.fromCharCode(b); i++; continue; }
      let need;
      let cp;
      if (b >= 0xc2 && b <= 0xdf) { need = 1; cp = b & 0x1f; }
      else if (b >= 0xe0 && b <= 0xef) { need = 2; cp = b & 0x0f; }
      else if (b >= 0xf0 && b <= 0xf4) { need = 3; cp = b & 0x07; }
      else { bad(i, i + 1); i += 1; continue; }
      let j = 1;
      let broke = false;
      for (; j <= need; j++) {
        const c = u8[i + j];
        if (c === undefined) { broke = true; break; }
        // The second byte of a three- or four-byte sequence is range-limited:
        // these are the checks that reject overlongs, UTF-16 surrogates
        // encoded as UTF-8, and code points above U+10FFFF.
        if (j === 1) {
          if (b === 0xe0 && !(c >= 0xa0 && c <= 0xbf)) { broke = true; break; }
          if (b === 0xed && !(c >= 0x80 && c <= 0x9f)) { broke = true; break; }
          if (b === 0xf0 && !(c >= 0x90 && c <= 0xbf)) { broke = true; break; }
          if (b === 0xf4 && !(c >= 0x80 && c <= 0x8f)) { broke = true; break; }
        }
        if (c < 0x80 || c > 0xbf) { broke = true; break; }
        cp = (cp << 6) | (c & 0x3f);
      }
      if (broke) { bad(i, i + j); i += j; continue; }
      out += String.fromCodePoint(cp);
      i += need + 1;
    }
    return out;
  }

  /** str.encode("utf-8", errors="surrogateescape"). */
  function encodeUtf8(str) {
    /* Fast path. Under the u flag a well-formed pair is one code point and not
     * in the Surrogate category, so this test finds exactly the lone surrogates
     * that surrogateescape puts in a string and that TextEncoder would turn
     * into U+FFFD. Without one, TextEncoder produces the same bytes Python
     * does. */
    if (TE && !RE_LONE_SURROGATE.test(str)) return TE.encode(str);
    // Three bytes per UTF-16 unit is the ceiling: a pair costs four across two.
    const out = new Uint8Array(str.length * 3);
    let n = 0;
    for (const ch of str) {
      const cp = ch.codePointAt(0);
      if (cp >= 0xdc80 && cp <= 0xdcff) { out[n++] = cp - 0xdc00; continue; }
      if (cp < 0x80) { out[n++] = cp; }
      else if (cp < 0x800) { out[n++] = 0xc0 | (cp >> 6); out[n++] = 0x80 | (cp & 63); }
      else if (cp < 0x10000) { out[n++] = 0xe0 | (cp >> 12); out[n++] = 0x80 | ((cp >> 6) & 63); out[n++] = 0x80 | (cp & 63); }
      else {
        out[n++] = 0xf0 | (cp >> 18); out[n++] = 0x80 | ((cp >> 12) & 63);
        out[n++] = 0x80 | ((cp >> 6) & 63); out[n++] = 0x80 | (cp & 63);
      }
    }
    return out.slice(0, n);
  }

  // ---- base64 and percent-encoding --------------------------------------

  const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const B64_VALUES = (() => {
    const m = new Int16Array(128).fill(-1);
    for (let i = 0; i < B64_ALPHABET.length; i++) m[B64_ALPHABET.charCodeAt(i)] = i;
    return m;
  })();

  /**
   * base64.b64decode(s) with CPython's non-strict rules, which are not the
   * ones btoa/atob follow: a character outside the alphabet is ignored rather
   * than fatal, "=" is ignored while a quantum is still empty or one character
   * in, and a quantum short by one or two characters needs exactly one or two
   * "=" to close it. Throws on the two shapes CPython refuses.
   */
  function b64decode(s) {
    // Four input characters carry at most three bytes, and an embedded image
    // arrives here as a megabyte of base64, so the output is sized once.
    const out = new Uint8Array(((s.length >> 2) + 1) * 3);
    let n = 0;
    let quad = 0;
    let bits = 0;
    let pads = 0;
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      if (code === 61 /* = */) {
        if (quad < 2) continue;              // nothing to close yet
        pads += 1;
        // 18 bits left is two bytes, 12 bits is one; the rest is the padding.
        if (quad === 3 && pads === 1) { out[n++] = (bits >> 10) & 0xff; out[n++] = (bits >> 2) & 0xff; return out.slice(0, n); }
        if (quad === 2 && pads === 2) { out[n++] = (bits >> 4) & 0xff; return out.slice(0, n); }
        continue;
      }
      const v = code < 128 ? B64_VALUES[code] : -1;
      if (v < 0) continue;                    // ignored, exactly as binascii does
      if (pads) throw new Error("Incorrect padding");
      bits = (bits << 6) | v;
      quad += 1;
      if (quad === 4) {
        out[n++] = (bits >> 16) & 0xff; out[n++] = (bits >> 8) & 0xff; out[n++] = bits & 0xff;
        quad = 0; bits = 0;
      }
    }
    if (pads) throw new Error("Incorrect padding");
    if (quad === 1) throw new Error("Invalid base64-encoded string: number of data characters cannot be 1 more than a multiple of 4");
    if (quad === 2 || quad === 3) throw new Error("Incorrect padding");
    return out.slice(0, n);
  }

  // Two output characters per table entry, so a 3-byte group costs two lookups
  // and one concatenation instead of four and three. An embedded image is
  // re-encoded in full every time a document carrying one is cleaned.
  const B64_PAIRS = (() => {
    const t = new Array(4096);
    for (let i = 0; i < 4096; i++) t[i] = B64_ALPHABET[i >> 6] + B64_ALPHABET[i & 63];
    return t;
  })();

  /** base64.b64encode(data).decode("ascii"). */
  function b64encode(u8) {
    let out = "";
    let i = 0;
    for (; i + 2 < u8.length; i += 3) {
      const n = (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2];
      out += B64_PAIRS[n >> 12] + B64_PAIRS[n & 4095];
    }
    const left = u8.length - i;
    if (left === 1) {
      const n = u8[i] << 16;
      out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + "==";
    } else if (left === 2) {
      const n = (u8[i] << 16) | (u8[i + 1] << 8);
      out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + B64_ALPHABET[(n >> 6) & 63] + "=";
    }
    return out;
  }

  const RE_TWO_HEX = /^[0-9a-fA-F]{2}$/;

  /** urllib.parse.unquote_to_bytes(s): a malformed escape stays literal. */
  function unquoteToBytes(s) {
    const src = encodeUtf8(s);
    const out = new Uint8Array(src.length);
    let n = 0;
    for (let i = 0; i < src.length; i++) {
      if (src[i] !== 0x25 /* % */) { out[n++] = src[i]; continue; }
      const hex = String.fromCharCode(src[i + 1] || 0, src[i + 2] || 0);
      if (RE_TWO_HEX.test(hex)) { out[n++] = parseInt(hex, 16); i += 2; continue; }
      out[n++] = src[i];
    }
    return out.slice(0, n);
  }

  // urllib's _ALWAYS_SAFE plus quote_from_bytes' default safe="/". Note what is
  // NOT here: encodeURIComponent leaves !'()* alone and escapes /, so it is
  // wrong in both directions for this.
  const QUOTE_SAFE = (() => {
    const safe = new Uint8Array(256);
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-~/";
    for (const ch of chars) safe[ch.charCodeAt(0)] = 1;
    return safe;
  })();
  const HEX = "0123456789ABCDEF";
  // The whole answer for a byte, precomputed: the character itself when it is
  // safe, its escape when it is not.
  const QUOTE_TABLE = (() => {
    const t = new Array(256);
    for (let b = 0; b < 256; b++) t[b] = QUOTE_SAFE[b] ? String.fromCharCode(b) : "%" + HEX[b >> 4] + HEX[b & 15];
    return t;
  })();

  /** urllib.parse.quote_from_bytes(data) with the default safe="/". */
  function quoteFromBytes(u8) {
    let out = "";
    for (let i = 0; i < u8.length; i++) out += QUOTE_TABLE[u8[i]];
    return out;
  }

  // ---- shared AI vocabulary ---------------------------------------------

  const AI_FRONTMATTER_KEYS = new Set([
    "generator", "ai", "ai_generated", "ai-generated", "claude", "anthropic", "openai",
    "gemini", "synthid", "c2pa", "content_credentials", "contentcredentials", "provenance",
    "digital_source_type", "digitalsourcetype", "created_with", "createdwith", "model", "llm",
  ]);

  const AI_META_NAME_RE = compilePy(
    "generator|ai[-_ ]?generated|claude|anthropic|openai|gemini|synthid|"
    + "c2pa|content.?credential|provenance|digital.?source|aigc", true);

  /* Names whose value names the producing tool. These are the document
   * analogue of PNG's Software/Creator/parameters chunks: only under one of
   * these names does a value like "Claude" mean provenance rather than
   * subject matter. */
  const GENERATOR_NAME_KEYS = new Set([
    "generator", "generated_by", "generatedby", "generated-by",
    "generated_with", "generatedwith", "generated-with",
    "created_with", "createdwith", "created-with",
    "made_with", "madewith", "made-with",
    "written_by", "writtenby", "written-by",
    "produced_by", "producedby", "produced-by",
    "authored_by", "authoredby", "authored-by",
    "creator", "producer", "software", "tool", "engine",
  ]);

  /* Values carried by any other name are free prose, so they are matched only
   * against markers that are never ordinary English. Anchored on word
   * boundaries so "aigc" cannot match inside another word. */
  const AI_FREE_TEXT_MARKER_RE = compilePy(
    "\\bc2pa\\b|\\bcontent[-_ ]?credentials?\\b|\\bcontentauth\\b|\\bcai:|"
    + "\\bsynthid\\b|\\baigc\\b|\\bdigital[-_ ]?source[-_ ]?type\\b|"
    + "\\b(?:trained[-_ ]?)?algorithmic[-_ ]?media\\b|"
    + "\\b(?:generated|created|made|written|produced|authored)\\s+(?:with|by|using)\\b", true);

  /**
   * True when a named value is evidence of a provenance mark. Shared by the
   * inspect and clean paths of every format on purpose: a checker and the
   * cleaner it gates must not be able to disagree about what counts.
   */
  function namedValueIsAi(name, value) {
    if (GENERATOR_NAME_KEYS.has(name.toLowerCase())) {
      if (search(AI_META_NAME_RE, value)) return true;
      const low = value.toLowerCase();
      return IM.AI_GENERATOR_PRODUCTS.some((p) => low.includes(p.toLowerCase()));
    }
    return search(AI_FREE_TEXT_MARKER_RE, value);
  }

  // ---- marker hits in an opaque blob ------------------------------------

  const firstLabel = (f) => { const i = f.indexOf(":"); return i === -1 ? f : f.slice(i + 1); };

  /** _blob_hits(blob) -> {hasC2pa, hasAi, findings} */
  function blobHits(u8) {
    const findings = [];
    let hasC2pa = false;
    let hasAi = false;
    for (const n of IM.containsAny(u8, IM.C2PA_MARKERS)) { hasC2pa = true; findings.push("marker:" + n); }
    for (const n of IM.containsAny(u8, IM.AI_META_HINTS)) {
      hasAi = true;
      if (!findings.some((f) => firstLabel(f) === n)) findings.push("ai:" + n);
    }
    return { hasC2pa, hasAi: hasAi || hasC2pa, findings: findings.slice(0, 30) };
  }

  // ---- embedded data URIs -----------------------------------------------

  const ASCII_ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const charSet = (s) => new Set(s.split(""));
  const DATA_URI_MIME_CHARS = charSet(ASCII_ALNUM + "+-.");
  const DATA_URI_PAYLOAD_CHARS = charSet(ASCII_ALNUM + "+/=%");
  const DATA_URI_BREAK = charSet("\"'<>()");
  const DATA_URI_PARAM_BREAK = charSet("\"'<>(),;");

  /**
   * Yield [start, end, mime, params, payload] for each data:image URI.
   * Linear whatever the input looks like: a candidate that does not form a URI
   * is skipped across rather than rescanned from the next character.
   */
  function* iterDataUris(text) {
    const n = text.length;
    let pos = 0;
    /* ASCII-only case folding: Python lowercases the whole string here and
     * indexes the original with the result's offsets, which only holds while
     * the two have the same length. They do not for U+0130, in either
     * language, so this searches the original instead of a lowered copy. */
    for (;;) {
      const i = ciIndexOf(RE_DATA_IMAGE_URI, text, pos);
      if (i < 0) return;
      let k = i + "data:image/".length;
      const mimeStart = k;
      while (k < n && DATA_URI_MIME_CHARS.has(text[k])) k += 1;
      const mime = text.slice(mimeStart, k);
      if (!mime) { pos = i + 1; continue; }
      const paramsStart = k;
      while (k < n && text[k] === ";") {
        k += 1;
        while (k < n && !DATA_URI_PARAM_BREAK.has(text[k]) && !pyIsSpace(text[k])) k += 1;
      }
      const params = text.slice(paramsStart, k);
      if (k >= n || text[k] !== ",") { pos = skipDataUriCandidate(text, i); continue; }
      k += 1;
      const payloadStart = k;
      while (k < n && (DATA_URI_PAYLOAD_CHARS.has(text[k]) || pyIsSpace(text[k]))) k += 1;
      const payload = text.slice(payloadStart, k);
      if (!payload) { pos = skipDataUriCandidate(text, i); continue; }
      yield [i, k, mime, params, payload];
      pos = k;
    }
  }

  function skipDataUriCandidate(text, start) {
    const n = text.length;
    let j = start;
    while (j < n && !DATA_URI_BREAK.has(text[j])) j += 1;
    return j > start + 1 ? j : start + 1;
  }

  const RE_PY_SPACE_RUN = compilePy("\\s+", false);

  /** Decode one data URI payload, or null when it is not decodable. */
  function decodePayload(params, payload) {
    const isB64 = params.toLowerCase().includes("base64");
    try {
      if (!isB64) return unquoteToBytes(payload);
      let raw = payload.replace(RE_PY_SPACE_RUN, "");
      const pad = raw.length % 4;
      if (pad) raw += "=".repeat(4 - pad);
      return b64decode(raw);
    } catch (_) {
      return null;
    }
  }

  /** _inspect_embedded_data_uris(text) -> {hasC2pa, hasAi, findings} */
  function inspectEmbeddedDataUris(text) {
    let hasC2pa = false;
    let hasAi = false;
    const findings = [];
    for (const [, , mime, params, payload] of iterDataUris(text)) {
      const mimeL = mime.toLowerCase();
      const data = decodePayload(params, payload);
      if (!data || !data.length) continue;
      const fmt = IM.detectFormat(data);
      let sub;
      if (fmt === "png") sub = IM.inspectPng(data);
      else if (fmt === "jpeg") sub = IM.inspectJpeg(data);
      else if (fmt === "webp") sub = IM.inspectWebp(data);
      else if (fmt === "avif" || fmt === "heic") sub = IM.inspectIsobmff(data, fmt);
      else if (mimeL.includes("svg") || startsWithAngle(data)) sub = inspectSvg(data);
      else sub = blobHits(data);
      if (sub.hasC2pa) hasC2pa = true;
      if (sub.hasAi || sub.hasC2pa) hasAi = true;
      for (const f of sub.findings) findings.push(`embedded data:image/${mimeL}: ${f}`);
    }
    return { hasC2pa, hasAi, findings };
  }

  /** bytes.lstrip().startswith(b"<"), without copying the blob. */
  function startsWithAngle(u8) {
    for (let i = 0; i < u8.length; i++) {
      const b = u8[i];
      // bytes.lstrip() strips the ASCII whitespace set, not Python's Unicode one.
      if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0b || b === 0x0c || b === 0x0d) continue;
      return b === 0x3c;
    }
    return false;
  }

  /** _clean_embedded_data_uris(text, opts) -> {text, actions} */
  function cleanEmbeddedDataUris(text, { stripAllMetadata = true } = {}) {
    const actions = [];

    const cleanOne = (mime, params, payload) => {
      const isB64 = params.toLowerCase().includes("base64");
      const data = decodePayload(params, payload);
      if (!data || !data.length) return null;
      const fmt = IM.detectFormat(data);
      let cleaned = data;
      let subActions = [];
      try {
        if (fmt === "png") ({ data: cleaned, actions: subActions } = IM.stripPng(data, { stripAllText: stripAllMetadata }));
        else if (fmt === "jpeg") ({ data: cleaned, actions: subActions } = IM.stripJpeg(data, { stripAllApp: stripAllMetadata }));
        else if (fmt === "webp") ({ data: cleaned, actions: subActions } = IM.stripWebp(data, { stripAllMetadata }));
        else if (fmt === "avif" || fmt === "heic") ({ data: cleaned, actions: subActions } = IM.stripIsobmff(data, fmt, { stripAllMetadata }));
        else if (mime.toLowerCase().includes("svg") || startsWithAngle(data)) ({ data: cleaned, actions: subActions } = cleanSvg(data));
      } catch (_) {
        return null;
      }
      if (!subActions.some((a) => a.toLowerCase().includes("drop")) || sameBytes(cleaned, data)) return null;
      actions.push(`cleaned embedded data:image/${mime} (${subActions.slice(0, 2).join(", ")})`);
      if (isB64) return `data:image/${mime}${params},${b64encode(cleaned)}`;
      return `data:image/${mime}${params},${quoteFromBytes(cleaned)}`;
    };

    const out = [];
    let last = 0;
    for (const [start, end, mime, params, payload] of iterDataUris(text)) {
      out.push(text.slice(last, start));
      const rebuilt = cleanOne(mime, params, payload);
      out.push(rebuilt === null ? text.slice(start, end) : rebuilt);
      last = end;
    }
    out.push(text.slice(last));
    return { text: out.join(""), actions };
  }

  function sameBytes(a, b) {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /**
   * indexOf for a lowercase ASCII needle, matched case-insensitively against
   * the original text.
   *
   * This is what upstream's `text.lower().find(needle)` amounts to, minus the
   * lowered copy of the whole document, which for a page carrying a megabyte
   * of embedded base64 was the dominant cost of a scan. The `i` flag without
   * `u` folds ASCII letters and nothing else: U+0130 and U+0131 are left alone
   * because their case mapping leaves the non-ASCII side non-ASCII, which is
   * precisely the ASCII-only rule this port already chose over upstream's
   * length-changing `str.lower()`.
   */
  function ciIndexOf(re, text, from) {
    re.lastIndex = from;
    const m = re.exec(text);
    return m ? m.index : -1;
  }

  const RE_DATA_IMAGE_URI = /data:image\//gi;
  const RE_SCRIPT_OPEN = /<script/gi;

  // ---- linear tag-block scanning ----------------------------------------
  //
  // The lazy ".*?</close>" idiom is quadratic on adversarial input: with many
  // opening tags and no closing tag, the engine rescans to end of input from
  // every candidate start. The helpers below locate every opening and closing
  // tag once and pair them with a forward pointer, while preserving the match
  // semantics of a lazy ".*?" (the first closing tag at or after each opening
  // tag's end, blocks never overlapping).

  function allMatches(re, text) {
    re.lastIndex = 0;
    const out = [];
    for (const m of text.matchAll(re)) out.push([m.index, m.index + m[0].length]);
    return out;
  }

  function* iterTagBlocks(text, openRe, closeRe) {
    const closes = allMatches(closeRe, text);
    let ci = 0;
    let lastEnd = 0;
    for (const [os, oe] of allMatches(openRe, text)) {
      if (os < lastEnd) continue;
      while (ci < closes.length && closes[ci][0] < oe) ci += 1;
      if (ci >= closes.length) return;
      const [cs, ce] = closes[ci];
      yield [os, oe, cs, ce];
      lastEnd = ce;
    }
  }

  function dropTagBlocks(text, openRe, closeRe) {
    return dropBlocksIf(text, openRe, closeRe, null);
  }

  function dropBlocksIf(text, openRe, closeRe, predicate) {
    const out = [];
    let last = 0;
    let count = 0;
    for (const [os, , , ce] of iterTagBlocks(text, openRe, closeRe)) {
      if (predicate && !predicate(text.slice(os, ce))) continue;
      out.push(text.slice(last, os));
      last = ce;
      count += 1;
    }
    if (!count) return { text, count: 0 };
    out.push(text.slice(last));
    return { text: out.join(""), count };
  }

  // ---- SVG ---------------------------------------------------------------

  const SVG_METADATA_OPEN_RE = compilePy("<metadata\\b[^>]*>", true);
  const SVG_METADATA_CLOSE_RE = compilePy("</metadata\\s*>", true);
  const SVG_XMPMETA_OPEN_RE = compilePy("<x:xmpmeta\\b[^>]*>", true);
  const SVG_XMPMETA_CLOSE_RE = compilePy("</x:xmpmeta\\s*>", true);
  const SVG_COMMENT_OPEN_RE = compilePy("<!--", false);
  // HTML comment end tags are "-->" or "--!>". XML/SVG only emits "-->", but
  // accepting both keeps the scrub effective on HTML-flavoured input.
  const SVG_COMMENT_CLOSE_RE = compilePy("--!?>", false);

  const SVG_HAS_METADATA_RE = compilePy("<metadata[\\s>]", true);
  const SVG_XMP_LIKE_RE = compilePy("xmpmeta|rdf:RDF|contentcredentials", true);
  const SVG_C2PA_RE = compilePy("c2pa|jumbf", true);

  /** inspect_svg(data) -> {hasC2pa, hasAi, findings, details} */
  function inspectSvg(u8) {
    const findings = [];
    const hits = blobHits(u8);
    let hasC2pa = hits.hasC2pa;
    let hasAi = hits.hasAi;
    findings.push(...hits.findings);
    try {
      const text = decodeUtf8(u8, "replace");
      if (search(SVG_HAS_METADATA_RE, text)) {
        findings.push("svg <metadata> present");
        hasAi = true;  // often XMP; treat as inspect signal
      }
      if (search(SVG_XMP_LIKE_RE, text)) {
        hasAi = true;
        findings.push("XMP/RDF-like content in SVG");
      }
      if (search(SVG_C2PA_RE, text)) hasC2pa = true;
      const uri = inspectEmbeddedDataUris(text);
      if (uri.hasC2pa) hasC2pa = true;
      if (uri.hasAi) hasAi = true;
      findings.push(...uri.findings);
    } catch (e) {
      findings.push(`svg decode note: ${(e && e.message) || e}`);
    }
    return { hasC2pa, hasAi: hasAi || hasC2pa, findings, details: {} };
  }

  const XML_DECL_KEYWORDS = ["doctype", "entity"];

  /** "doctype"/"entity" when text[i:] opens that declaration, else null. */
  function xmlDeclKeyword(text, i) {
    if (text.slice(i, i + 2) !== "<!") return null;
    const rest = text.slice(i + 2);
    const restLow = rest.toLowerCase();
    for (const kw of XML_DECL_KEYWORDS) {
      if (restLow.startsWith(kw)) {
        // Require a word boundary so names like <!DOCTYPEfoo> are not matched.
        const nxt = rest.slice(kw.length, kw.length + 1);
        if (nxt && (pyIsAlnum(nxt) || nxt === "_" || nxt === ":")) return null;
        return kw;
      }
    }
    return null;
  }

  /**
   * The index just past a declaration's closing ">", or -1 when unterminated.
   * Quotes and the internal subset are respected, so a ">" inside a quoted
   * external identifier or a nested subset does not end it early.
   */
  function xmlDeclEnd(text, i, keyword) {
    let j = i + 2 + keyword.length;
    const n = text.length;
    let quote = null;
    let subsetDepth = 0;
    while (j < n) {
      const c = text[j];
      if (quote !== null) {
        // Line breaks are legal inside quoted literals, so they do not
        // terminate the declaration; the first unquoted ">" does.
        if (c === quote) quote = null;
        j += 1;
        continue;
      }
      // A DTD comment must not affect subsetDepth or look like a close.
      if (text.startsWith("<!--", j)) {
        const end = text.indexOf("-->", j);
        if (end === -1) return -1;
        j = end + 3;
        continue;
      }
      if (c === '"' || c === "'") { quote = c; j += 1; continue; }
      if (c === "[") { subsetDepth += 1; j += 1; continue; }
      if (c === "]") { if (subsetDepth) subsetDepth -= 1; j += 1; continue; }
      if (c === ">" && subsetDepth === 0) return j + 1;
      j += 1;
    }
    return -1;
  }

  /**
   * Remove top-level <!DOCTYPE ...> and <!ENTITY ...> declarations. Only
   * declarations in markup context go: matching text inside CDATA, comments
   * and quoted attribute values is preserved, and an unterminated declaration
   * is left intact rather than half-deleted.
   */
  function stripXmlDeclarations(text) {
    let i = 0;
    const n = text.length;
    const out = [];
    let removed = 0;
    let inTag = false;
    let quote = null;
    while (i < n) {
      const c = text[i];
      if (inTag) {
        if (quote !== null) {
          out.push(c);
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
          quote = c;
          out.push(c);
        } else if (c === ">") {
          inTag = false;
          out.push(c);
        } else {
          out.push(c);
        }
        i += 1;
        continue;
      }
      if (text.startsWith("<![CDATA[", i)) {
        const end = text.indexOf("]]>", i);
        if (end === -1) { out.push(text.slice(i)); break; }
        out.push(text.slice(i, end + 3));
        i = end + 3;
        continue;
      }
      if (text.startsWith("<!--", i)) {
        const end = text.indexOf("-->", i);
        if (end === -1) { out.push(text.slice(i)); break; }
        out.push(text.slice(i, end + 3));
        i = end + 3;
        continue;
      }
      const keyword = xmlDeclKeyword(text, i);
      if (keyword) {
        const end = xmlDeclEnd(text, i, keyword);
        if (end === -1) { out.push(c); i += 1; continue; }
        removed += 1;
        i = end;
        continue;
      }
      out.push(c);
      if (c === "<") inTag = true;
      i += 1;
    }
    return { text: out.join(""), count: removed };
  }

  const SVG_ROOT_ATTR_RE = compilePy(
    "\\s(?:inkscape:version|sodipodi:docname|generator)\\s*=\\s*(\"[^\"]*\"|'[^']*')", true);

  /**
   * Remove provenance attributes from the root <svg ...> start tag only, so
   * matching text in CDATA, comments or text content is untouched.
   */
  function stripRootSvgAttrs(text) {
    const n = text.length;
    let i = 0;
    let start = -1;
    while (i < n) {
      if (text.startsWith("<![CDATA[", i)) {
        const end = text.indexOf("]]>", i);
        if (end === -1) return { text, count: 0 };
        i = end + 3;
        continue;
      }
      if (text.startsWith("<!--", i)) {
        const end = text.indexOf("-->", i);
        if (end === -1) return { text, count: 0 };
        i = end + 3;
        continue;
      }
      if (text.startsWith("<?", i)) {
        // A processing instruction may contain "<svg"; skip it so the root
        // element start tag is what gets cleaned.
        const end = text.indexOf("?>", i);
        if (end === -1) return { text, count: 0 };
        i = end + 2;
        continue;
      }
      if (text.slice(i, i + 4).toLowerCase() === "<svg") {
        const nxt = text.slice(i + 4, i + 5);
        if (!(nxt && (pyIsAlnum(nxt) || "_:.-".includes(nxt)))) { start = i; break; }
      }
      i += 1;
    }
    if (start === -1) return { text, count: 0 };
    let j = start + 4;
    let quote = null;
    let closed = false;
    while (j < n) {
      const c = text[j];
      if (quote !== null) {
        if (c === quote) quote = null;
        j += 1;
        continue;
      }
      if (c === '"' || c === "'") { quote = c; j += 1; continue; }
      if (c === ">") { closed = true; break; }
      j += 1;
    }
    if (!closed) return { text, count: 0 };  // unclosed start tag; leave as-is
    const tag = text.slice(start, j + 1);
    let count = 0;
    SVG_ROOT_ATTR_RE.lastIndex = 0;
    const newTag = tag.replace(SVG_ROOT_ATTR_RE, () => { count += 1; return ""; });
    if (!count) return { text, count: 0 };
    return { text: text.slice(0, start) + newTag + text.slice(j + 1), count };
  }

  /** clean_svg(data) -> {data, actions} */
  function cleanSvg(u8) {
    const actions = [];
    let text = decodeUtf8(u8, "surrogateescape");

    let r = dropTagBlocks(text, SVG_METADATA_OPEN_RE, SVG_METADATA_CLOSE_RE);
    if (r.count) { actions.push(`drop <metadata> x${r.count}`); text = r.text; }

    r = dropTagBlocks(text, SVG_XMPMETA_OPEN_RE, SVG_XMPMETA_CLOSE_RE);
    if (r.count) { actions.push(`drop xmpmeta x${r.count}`); text = r.text; }

    const decls = stripXmlDeclarations(text);
    text = decls.text;
    if (decls.count) actions.push(`drop DOCTYPE/entity declarations x${decls.count}`);

    r = dropBlocksIf(text, SVG_COMMENT_OPEN_RE, SVG_COMMENT_CLOSE_RE, (block) => search(AI_META_NAME_RE, block));
    if (r.count) {
      for (let k = 0; k < r.count; k++) actions.push("drop SVG comment with AI markers");
      text = r.text;
    }

    const uri = cleanEmbeddedDataUris(text);
    text = uri.text;
    if (uri.actions.length) actions.push(...uri.actions);

    // Root attributes go whenever they are present, not only when something
    // else needed cleaning.
    const rootAttrs = stripRootSvgAttrs(text);
    text = rootAttrs.text;
    if (rootAttrs.count) actions.push(`drop generator-like attrs x${rootAttrs.count}`);

    if (!actions.length) actions.push("no SVG metadata removed");
    return { data: encodeUtf8(text), actions };
  }


  // ---- HTML ---------------------------------------------------------------

  const META_TAG_RE = compilePy("<meta\\b[^>]*>", true);
  const META_ATTR_RE = compilePy("(name|property|content|generator)\\s*=\\s*[\"']([^\"']*)[\"']", true);

  // Known AI vendor names for the "generator" meta tag. A plain CMS generator
  // (WordPress, Elementor) is CMS provenance, not AI-generator metadata.
  const GENERATOR_AI_RE = compilePy(
    "claude|anthropic|openai|chatgpt|gemini|synthid|copilot|midjourney|dall.?e|stable.?diffusion", true);

  function metaAttrs(tag) {
    const out = {};
    META_ATTR_RE.lastIndex = 0;
    for (const m of tag.matchAll(META_ATTR_RE)) out[m[1].toLowerCase()] = m[2];
    return out;
  }

  /** True for a generator meta tag that is CMS provenance, not AI. */
  function isCmsGeneratorMeta(tag) {
    const attrs = metaAttrs(tag);
    const nameOrProp = (attrs.name || attrs.property || attrs.generator || "").toLowerCase();
    if (nameOrProp !== "generator") return false;
    return !(search(GENERATOR_AI_RE, attrs.content || "") || search(GENERATOR_AI_RE, tag));
  }

  const META_CONTENT_VALUE_RE = compilePy("(\\bcontent\\s*=\\s*)([\"'])[^\"']*\\2", true);

  /**
   * True when an HTML <meta> tag is evidence of a provenance mark. Only the
   * `content` value is judged by the free-prose rule; the rest of the tag keeps
   * the whole-tag scan, so anything that used to be caught in another
   * attribute still is. Without the split a page loses its description to a
   * sentence about "a static site generator".
   */
  function metaTagIsAi(tag) {
    const attrs = metaAttrs(tag);
    const name = attrs.name || attrs.property || attrs.generator || "";
    const content = attrs.content || "";
    /* Blank the `content` attribute specifically. A plain replace of the value
     * would also erase an identical string in another attribute, so
     * <meta property="Claude" content="Claude"> would lose both copies and
     * read clean, which is the opposite of what this split guarantees. */
    META_CONTENT_VALUE_RE.lastIndex = 0;
    const skeleton = tag.replace(META_CONTENT_VALUE_RE, "$1$2$2");
    const low = skeleton.toLowerCase();
    if (search(AI_META_NAME_RE, skeleton) || IM.AI_META_HINTS.slice(0, 12).some((h) => low.includes(h.toLowerCase()))) {
      return true;
    }
    return namedValueIsAi(name, content);
  }

  const JSONLD_CLOSE_RE = compilePy("</script>", true);
  // HTML treats form feed as whitespace; include it wherever attribute
  // separators are checked.
  const HTML_SPACE = " \t\r\n\f";

  /**
   * The index just after the closing ">" of the tag at `start`. Quote-aware, so
   * a ">" inside a quoted attribute value does not end the tag. Returns
   * text.length for an unterminated tag.
   */
  function findTagEnd(text, start) {
    const n = text.length;
    let i = start + 1;
    while (i < n) {
      const c = text[i];
      if (c === ">") return i + 1;
      if (c === '"' || c === "'") {
        const quote = c;
        i += 1;
        while (i < n && text[i] !== quote) i += 1;
        i += 1;  // skip closing quote
      } else {
        i += 1;
      }
    }
    return n;
  }

  /**
   * Yield [openStart, openEnd, closeStart, closeEnd] for script blocks. Linear
   * and quote-aware, with no length cap on the opening tag, so an unterminated
   * run of "<script" costs one pass rather than a rescan per prefix.
   */
  function* iterScriptBlocks(text) {
    const closes = allMatches(JSONLD_CLOSE_RE, text).map(([a]) => a);
    let ci = 0;
    let lastEnd = 0;
    let pos = 0;
    const n = text.length;
    // ASCII-only, for the reason spelled out on ciIndexOf and iterDataUris.
    for (;;) {
      const i = ciIndexOf(RE_SCRIPT_OPEN, text, pos);
      if (i < 0) return;
      const after = i + 7;
      if (after >= n || !(">" + HTML_SPACE + "/").includes(text[after])) { pos = i + 1; continue; }
      const openEnd = findTagEnd(text, i);
      if (i < lastEnd) { pos = Math.max(openEnd, i + 1); continue; }
      while (ci < closes.length && closes[ci] < openEnd) ci += 1;
      if (ci >= closes.length) return;
      const closeStart = closes[ci];
      const closeEnd = closeStart + "</script>".length;
      yield [i, openEnd, closeStart, closeEnd];
      lastEnd = closeEnd;
      pos = openEnd;
    }
  }

  /**
   * True iff the opening tag has a top-level type="application/ld+json".
   * Single-pass and quote-aware, so a quoted value is skipped as a unit and
   * only a real top-level attribute matches.
   */
  function scriptTagIsJsonld(openTag) {
    let i = 0;
    const n = openTag.length;
    if (i < n && openTag[i] === "<") i += 1;
    while (i < n && !(HTML_SPACE + "/>").includes(openTag[i])) i += 1;  // tag name
    while (i < n) {
      while (i < n && HTML_SPACE.includes(openTag[i])) i += 1;
      if (i >= n || openTag[i] === ">") return false;
      const nameStart = i;
      while (i < n && !("=" + HTML_SPACE + "/>").includes(openTag[i])) i += 1;
      const name = openTag.slice(nameStart, i);
      while (i < n && HTML_SPACE.includes(openTag[i])) i += 1;
      let value = "";
      if (i < n && openTag[i] === "=") {
        i += 1;
        while (i < n && HTML_SPACE.includes(openTag[i])) i += 1;
        if (i < n && (openTag[i] === '"' || openTag[i] === "'")) {
          const quote = openTag[i];
          i += 1;
          const valueStart = i;
          while (i < n && openTag[i] !== quote) i += 1;
          value = openTag.slice(valueStart, i);
          i += 1;  // skip closing quote
        } else {
          const valueStart = i;
          while (i < n && !(HTML_SPACE + ">").includes(openTag[i])) i += 1;
          value = openTag.slice(valueStart, i);
        }
      }
      if (name.toLowerCase() === "type" && value.toLowerCase() === "application/ld+json") return true;
    }
    return false;
  }

  /** Python's str[:n], which counts code points where JS counts UTF-16 units. */
  const head = (s, n) => [...s].slice(0, n).join("");

  const JSONLD_AI_RE = compilePy("DigitalSourceType|trainedAlgorithmicMedia|SoftwareAgent", true);
  const JSONLD_C2PA_RE = compilePy("c2pa|contentcredential", true);
  const HTML_C2PA_META_RE = compilePy("c2pa|content.?credential", true);
  /* Two spellings on purpose, matching upstream: inspect anchors on a word
   * boundary and reports the attribute alone, clean anchors on the preceding
   * whitespace so removing the attribute does not leave a double space. */
  const DATA_AI_FIND_RE = compilePy("\\bdata-ai[\\w-]*\\s*=\\s*[\"'][^\"']*[\"']", true);
  const DATA_AI_DROP_RE = compilePy("\\sdata-ai[\\w-]*\\s*=\\s*[\"'][^\"']*[\"']", true);

  /** inspect_html(text) -> {hasC2pa, hasAi, findings, details} */
  function inspectHtml(text) {
    const findings = [];
    let hasAi = false;
    let hasC2pa = false;
    META_TAG_RE.lastIndex = 0;
    for (const m of text.matchAll(META_TAG_RE)) {
      const tag = m[0];
      if (search(HTML_C2PA_META_RE, tag)) hasC2pa = true;
      if (isCmsGeneratorMeta(tag)) { findings.push(`info: cms generator: ${head(tag, 120)}`); continue; }
      if (metaTagIsAi(tag)) { hasAi = true; findings.push(`meta: ${head(tag, 120)}`); }
    }
    for (const [os, oe, , ce] of iterScriptBlocks(text)) {
      if (!scriptTagIsJsonld(text.slice(os, oe))) continue;
      const blob = text.slice(os, ce);
      if (search(AI_META_NAME_RE, blob) || search(JSONLD_AI_RE, blob)) {
        hasAi = true;
        findings.push("json-ld provenance-like block");
        if (search(JSONLD_C2PA_RE, blob)) hasC2pa = true;
      }
    }
    DATA_AI_FIND_RE.lastIndex = 0;
    for (const m of text.matchAll(DATA_AI_FIND_RE)) {
      hasAi = true;
      findings.push(`attr: ${head(m[0], 80)}`);
    }
    const uri = inspectEmbeddedDataUris(text);
    if (uri.hasC2pa) hasC2pa = true;
    if (uri.hasAi) hasAi = true;
    findings.push(...uri.findings);
    return { hasC2pa, hasAi, findings, details: {} };
  }

  /** clean_html(text) -> {text, actions} */
  function cleanHtml(text) {
    const actions = [];
    META_TAG_RE.lastIndex = 0;
    let out = text.replace(META_TAG_RE, (tag) => {
      if (isCmsGeneratorMeta(tag)) return tag;
      if (metaTagIsAi(tag)) { actions.push(`drop meta: ${head(tag, 80)}`); return ""; }
      return tag;
    });

    const blockIsAi = (openTag, blob) => {
      if (!scriptTagIsJsonld(openTag)) return false;
      return search(AI_META_NAME_RE, blob) || search(JSONLD_AI_RE, blob);
    };
    const kept = [];
    let last = 0;
    let n = 0;
    for (const [os, oe, , ce] of iterScriptBlocks(out)) {
      const blob = out.slice(os, ce);
      if (!blockIsAi(out.slice(os, oe), blob)) continue;
      kept.push(out.slice(last, os));
      last = ce;
      n += 1;
    }
    if (n) {
      kept.push(out.slice(last));
      out = kept.join("");
      for (let k = 0; k < n; k++) actions.push("drop json-ld provenance-like script");
    }

    let attrCount = 0;
    DATA_AI_DROP_RE.lastIndex = 0;
    const out2 = out.replace(DATA_AI_DROP_RE, () => { attrCount += 1; return ""; });
    if (attrCount) { actions.push(`drop data-ai* attributes x${attrCount}`); out = out2; }

    const uri = cleanEmbeddedDataUris(out);
    out = uri.text;
    if (uri.actions.length) actions.push(...uri.actions);

    if (!actions.length) actions.push("no HTML AI meta removed");
    return { text: out, actions };
  }

  // ---- Markdown frontmatter ----------------------------------------------

  // re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n?", re.DOTALL): \A is the start of
  // the string, and [\s\S] is the JS spelling of a dot under DOTALL.
  const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const FM_KEY_RE = compilePy("^([A-Za-z0-9_.-]+)\\s*:", false);

  const matchStart = (re, s) => { re.lastIndex = 0; const m = re.exec(s); return m && m.index === 0 ? m : null; };

  /** _parse_simple_yaml_keys(block) -> [[key, line, index], ...] for top-level keys. */
  function parseSimpleYamlKeys(block) {
    const rows = [];
    const lines = PyRe.pySplitlines(block);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const stripped = PyRe.pyStrip(line);
      if (!stripped || stripped.startsWith("#")) continue;
      if (line[0] === " " || line[0] === "\t" || line[0] === "-") continue;  // nested / list
      const m = matchStart(FM_KEY_RE, line);
      if (m) rows.push([m[1], line, i]);
    }
    return rows;
  }

  /* Frontmatter keys that are Claude Code agent/skill *configuration* and
   * happen to collide with provenance key names. `model` is in
   * AI_FRONTMATTER_KEYS, which is right for a generated document and wrong for
   * `.claude/agents/*.md`, where dropping it silently changes which model the
   * agent runs on. */
  const AGENT_CONFIG_KEYS = new Set(["model", "tools", "allowed-tools", "name", "description"]);

  /* The shape that identifies such a file without needing its path: a name, a
   * description and a tool grant. Ordinary prose frontmatter does not carry all
   * three, so this hands a real watermark no way to exempt itself, and values
   * are still checked, so `description: Generated with Claude Code` inside an
   * agent definition is still caught. */
  const AGENT_SHAPE_REQUIRED = [new Set(["name"]), new Set(["description"]), new Set(["tools", "allowed-tools"])];

  /** _is_agent_frontmatter(keys) */
  function isAgentFrontmatter(keys) {
    const lowered = new Set(keys.map((k) => k.toLowerCase()));
    return AGENT_SHAPE_REQUIRED.every((group) => [...group].some((k) => lowered.has(k)));
  }

  const afterColon = (line) => (line.includes(":") ? line.slice(line.indexOf(":") + 1) : "");

  /** inspect_markdown(text) -> {hasC2pa, hasAi, findings, details} */
  function inspectMarkdown(text) {
    const findings = [];
    let hasAi = false;
    let hasFm = false;
    const keys = [];
    const m = FM_RE.exec(text);
    if (m) {
      hasFm = true;
      const rows = parseSimpleYamlKeys(m[1]);
      const isAgent = isAgentFrontmatter(rows.map(([k]) => k));
      for (const [key, line] of rows) {
        keys.push(key);
        if (isAgent && AGENT_CONFIG_KEYS.has(key.toLowerCase())) {
          /* agent configuration, not provenance; the value is still checked below */
        } else if (AI_FRONTMATTER_KEYS.has(key.toLowerCase()) || search(AI_META_NAME_RE, key)) {
          hasAi = true;
          findings.push(`frontmatter key: ${key}`);
        }
        if (namedValueIsAi(key, afterColon(line))) {
          hasAi = true;
          findings.push(`frontmatter value hit on ${key}`);
        }
      }
    }
    const uri = inspectEmbeddedDataUris(text);
    if (uri.hasC2pa) hasAi = true;
    if (uri.hasAi) hasAi = true;
    findings.push(...uri.findings);
    const c2pa = uri.hasC2pa || findings.some((f) => {
      const low = f.toLowerCase();
      return low.includes("c2pa") || low.includes("content");
    });
    return { hasC2pa: c2pa, hasAi, findings, details: { has_frontmatter: hasFm, keys } };
  }

  const stripNewlines = (s) => s.replace(/^\n+/, "").replace(/\n+$/, "");
  const lstripNewlines = (s) => s.replace(/^\n+/, "");

  /** clean_markdown(text) -> {text, actions} */
  function cleanMarkdown(text) {
    const actions = [];
    const m = FM_RE.exec(text);
    let out;
    if (m) {
      const block = m[1];
      const body = text.slice(m[0].length);
      const kept = [];
      let dropping = false;  // inside the nested block of a dropped top-level key
      const isAgent = isAgentFrontmatter(parseSimpleYamlKeys(block).map(([k]) => k));
      for (const line of PyRe.pySplitlines(block)) {
        const stripped = PyRe.pyStrip(line);
        // Blank lines and comments belong to whichever block we are inside.
        if (!stripped || stripped.startsWith("#")) { if (!dropping) kept.push(line); continue; }
        // Continuation lines (nested mappings, list items) follow their parent.
        if (line[0] === " " || line[0] === "\t" || line[0] === "-") { if (!dropping) kept.push(line); continue; }
        const km = matchStart(FM_KEY_RE, line);
        if (!km) { dropping = false; kept.push(line); continue; }
        const key = km[1];
        const val = afterColon(line);
        if (isAgent && AGENT_CONFIG_KEYS.has(key.toLowerCase())) {
          /* agent configuration; fall through to the value check */
        } else if (AI_FRONTMATTER_KEYS.has(key.toLowerCase()) || search(AI_META_NAME_RE, key)) {
          actions.push(`drop frontmatter key: ${key}`);
          dropping = true;
          continue;
        }
        if (namedValueIsAi(key, val)) {
          actions.push(`drop frontmatter key (value hit): ${key}`);
          dropping = true;
          continue;
        }
        dropping = false;
        kept.push(line);
      }
      const newBlock = stripNewlines(kept.join("\n"));
      if (newBlock) {
        out = `---\n${newBlock}\n---\n${body}`;
      } else {
        out = lstripNewlines(body);
        actions.push("removed empty frontmatter block");
      }
    } else {
      out = text;
    }
    const uri = cleanEmbeddedDataUris(out);
    out = uri.text;
    if (uri.actions.length) actions.push(...uri.actions);
    if (!actions.length) actions.push("no AI frontmatter keys or embedded data URIs removed");
    return { text: out, actions };
  }

  const api = {
    decodeUtf8, encodeUtf8, b64decode, b64encode, unquoteToBytes, quoteFromBytes,
    namedValueIsAi, blobHits,
    iterDataUris, inspectEmbeddedDataUris, cleanEmbeddedDataUris,
    iterTagBlocks, dropTagBlocks, dropBlocksIf,
    inspectSvg, cleanSvg, stripXmlDeclarations, stripRootSvgAttrs,
    inspectHtml, cleanHtml, inspectMarkdown, cleanMarkdown,
    metaAttrs, isCmsGeneratorMeta, metaTagIsAi, scriptTagIsJsonld, iterScriptBlocks,
    parseSimpleYamlKeys,
    AI_FRONTMATTER_KEYS, GENERATOR_NAME_KEYS, AI_META_NAME_RE, AI_FREE_TEXT_MARKER_RE,
  };
  root.ContainerMeta = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
