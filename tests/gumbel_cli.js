#!/usr/bin/env node
// Test shim: read {"mode":"text"|"tokens", "text"|"tokens", "key", "options"}
// JSON on stdin, print the Gumbel report as JSON. Token ids travel as decimal
// strings so a 64-bit id survives the JSON round trip on both sides. Errors
// come back as {"error": "..."} so the parity suite can assert on them.
const path = require("path");
const Gumbel = require(path.join(__dirname, "..", "js", "gumbel.js"));
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let out;
  try {
    const req = JSON.parse(raw);
    const opts = req.options || {};
    out = req.mode === "tokens"
      ? Gumbel.detectTokenIds(req.tokens, req.key, opts)
      : Gumbel.detectText(req.text, req.key, opts);
  } catch (e) {
    out = { error: String((e && e.message) || e) };
  }
  process.stdout.write(JSON.stringify(out));
});
