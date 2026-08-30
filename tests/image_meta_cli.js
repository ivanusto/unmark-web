#!/usr/bin/env node
// Test shim: {"mode":"clean"|"inspect","file":<base64>,"options":{...}} on stdin -> JSON on stdout.
// Also {"mode":"scan","file":<base64>,"needles":[...]} -> {"found":[...]}, for the byte scanner.
// Also {"mode":"provscan","file":<base64>} -> {"found":bool}, for the C2PA BMFF user-type scan.
const path = require("path");
const ImageMeta = require(path.join(__dirname, "..", "js", "image_meta.js"));
let raw = ""; process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  const req = JSON.parse(raw);
  const u8 = new Uint8Array(Buffer.from(req.file, "base64"));
  try {
    if (req.mode === "inspect") return process.stdout.write(JSON.stringify(ImageMeta.inspect(u8)));
    if (req.mode === "scan") return process.stdout.write(JSON.stringify({ found: ImageMeta.containsAny(u8, req.needles) }));
    if (req.mode === "provscan") return process.stdout.write(JSON.stringify({ found: ImageMeta.containsC2paProvBox(u8) }));
    const r = ImageMeta.clean(u8, req.options || {});
    process.stdout.write(JSON.stringify({ format: r.format, actions: r.actions, data: Buffer.from(r.data).toString("base64") }));
  } catch (e) { process.stdout.write(JSON.stringify({ error: String(e.message || e) })); }
});
