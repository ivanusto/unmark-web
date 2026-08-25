#!/usr/bin/env node
// Test shim for js/av_meta.js. On stdin, JSON out:
//   {"mode":"detect","file":<base64>}                       -> {"format":...}
//   {"mode":"inspect","file":<base64>}                      -> the report
//   {"mode":"clean","file":<base64>,"options":{...}}         -> {format, actions, data}
// The same two with a "-file" suffix run the slice driver over a File built
// from the same bytes, so a caller can compare the two drivers directly.
const path = require("path");
const AvMeta = require(path.join(__dirname, "..", "js", "av_meta.js"));

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", async () => {
  const req = JSON.parse(raw);
  const bytes = Buffer.from(req.file, "base64");
  const u8 = new Uint8Array(bytes);
  const write = (o) => process.stdout.write(JSON.stringify(o));
  try {
    if (req.mode === "detect") return write({ format: AvMeta.detectAvFormat(u8) });
    if (req.mode === "inspect") return write(AvMeta.inspectAv(u8));
    if (req.mode === "clean") {
      const r = AvMeta.cleanAv(u8, req.options || {});
      return write({ format: r.format, actions: r.actions, data: Buffer.from(r.data).toString("base64") });
    }
    const file = new File([bytes], req.name || "input.bin");
    if (req.mode === "detect-file") return write({ format: await AvMeta.detectAvFormatFile(file) });
    if (req.mode === "inspect-file") return write(await AvMeta.inspectAvFile(file));
    if (req.mode === "clean-file") {
      const r = await AvMeta.cleanAvFile(file, req.options || {});
      const data = Buffer.from(await r.blob.arrayBuffer());
      return write({ format: r.format, actions: r.actions, data: data.toString("base64") });
    }
    write({ error: `unknown mode: ${req.mode}` });
  } catch (e) {
    write({ error: String((e && e.message) || e) });
  }
});
