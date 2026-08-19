#!/usr/bin/env node
// Test shim: read {"text":..., "options":{...}} JSON on stdin, print the
// Stylometry.score() report as JSON. Used by tests/test_stylometry_parity.py.
const path = require("path");
const Stylometry = require(path.join(__dirname, "..", "js", "stylometry.js"));
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  const req = JSON.parse(raw);
  process.stdout.write(JSON.stringify(Stylometry.score(req.text, req.options || {})));
});
