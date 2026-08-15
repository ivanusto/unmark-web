#!/usr/bin/env node
// Test shim: read {"text":..., "options":{...}, "mode":"clean"|"inspect"} JSON on stdin,
// print the engine result as JSON. Used by tests/test_layer_a_parity.py.
const path = require("path");
const LayerA = require(path.join(__dirname, "..", "js", "layer_a.js"));
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  const req = JSON.parse(raw);
  const out = req.mode === "inspect" ? LayerA.inspect(req.text, req.options) : LayerA.clean(req.text, req.options);
  process.stdout.write(JSON.stringify(out));
});
