#!/usr/bin/env node
// Test shim for js/container_meta.js: one JSON request on stdin, one JSON
// response on stdout. Bytes travel as base64; text travels as a JSON string,
// which carries the lone surrogates surrogateescape produces.
//
//   {"mode":"svg_inspect","file":<b64>}      -> {has_c2pa, has_ai, findings}
//   {"mode":"svg_clean","file":<b64>}        -> {data:<b64>, actions}
//   {"mode":"uri_inspect","text":<str>}      -> {has_c2pa, has_ai, findings}
//   {"mode":"uri_clean","text":<str>}        -> {text, actions}
//   {"mode":"blob_hits","file":<b64>}        -> {has_c2pa, has_ai, findings}
//   {"mode":"named_value","name","value"}    -> {is_ai}
//   {"mode":"decode","file":<b64>,"errors"}  -> {text}
//   {"mode":"encode","text":<str>}           -> {file:<b64>}
//   {"mode":"b64decode","s":<str>}           -> {data:<b64>} | {error}
//   {"mode":"quote","file":<b64>}            -> {text}
//   {"mode":"unquote","text":<str>}          -> {file:<b64>}
const path = require("path");
const CM = require(path.join(__dirname, "..", "js", "container_meta.js"));

const u8 = (b64) => new Uint8Array(Buffer.from(b64, "base64"));
const b64 = (bytes) => Buffer.from(bytes).toString("base64");

let raw = ""; process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  const req = JSON.parse(raw);
  const w = (o) => process.stdout.write(JSON.stringify(o));
  try {
    if (req.mode === "svg_inspect") {
      const r = CM.inspectSvg(u8(req.file));
      return w({ has_c2pa: r.hasC2pa, has_ai: r.hasAi, findings: r.findings });
    }
    if (req.mode === "svg_clean") {
      const r = CM.cleanSvg(u8(req.file));
      return w({ data: b64(r.data), actions: r.actions });
    }
    if (req.mode === "uri_inspect") {
      const r = CM.inspectEmbeddedDataUris(req.text);
      return w({ has_c2pa: r.hasC2pa, has_ai: r.hasAi, findings: r.findings });
    }
    if (req.mode === "uri_clean") {
      const r = CM.cleanEmbeddedDataUris(req.text, req.options || {});
      return w({ text: r.text, actions: r.actions });
    }
    if (req.mode === "blob_hits") {
      const r = CM.blobHits(u8(req.file));
      return w({ has_c2pa: r.hasC2pa, has_ai: r.hasAi, findings: r.findings });
    }
    if (req.mode === "named_value") return w({ is_ai: CM.namedValueIsAi(req.name, req.value) });
    if (req.mode === "decode") return w({ text: CM.decodeUtf8(u8(req.file), req.errors) });
    if (req.mode === "encode") return w({ file: b64(CM.encodeUtf8(req.text)) });
    if (req.mode === "b64decode") {
      try { return w({ data: b64(CM.b64decode(req.s)) }); }
      catch (e) { return w({ error: String(e.message || e) }); }
    }
    if (req.mode === "quote") return w({ text: CM.quoteFromBytes(u8(req.file)) });
    if (req.mode === "unquote") return w({ file: b64(CM.unquoteToBytes(req.text)) });
    w({ error: "unknown mode " + req.mode });
  } catch (e) { w({ error: String((e && e.message) || e) }); }
});
