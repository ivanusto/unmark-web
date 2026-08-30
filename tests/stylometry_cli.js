#!/usr/bin/env node
// Test shim for js/stylometry.js. On stdin, JSON out:
//   {"text":..., "options":{...}}   -> the Stylometry.score() report
//   {"mode":"confidence","findings":[...]} -> {"levels":[...]}, the port of
//                                             common.classify_finding_confidence
// Used by tests/test_stylometry_parity.py and tests/test_finding_confidence_parity.py.
const path = require("path");
const Stylometry = require(path.join(__dirname, "..", "js", "stylometry.js"));
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  const req = JSON.parse(raw);
  if (req.mode === "confidence") {
    const levels = req.findings.map((f) => Stylometry.classifyFindingConfidence(f));
    return process.stdout.write(JSON.stringify({ levels }));
  }
  process.stdout.write(JSON.stringify(Stylometry.score(req.text, req.options || {})));
});
