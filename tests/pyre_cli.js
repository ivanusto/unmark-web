#!/usr/bin/env node
// Test shim for js/pyre.js: {"cases": [[pattern, ignoreCase, subject], ...]}
// in, {"found": [start|null, ...]} out. Reports the offset of the first match
// so a difference in what matched shows up, not only whether anything did.
const PyRe = require("../js/pyre.js");

let raw = "";
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  const { cases } = JSON.parse(raw);
  const found = cases.map(([pattern, ignoreCase, subject]) => {
    const re = PyRe.compilePy(pattern, ignoreCase);
    re.lastIndex = 0;
    const m = re.exec(subject);
    return m ? m.index : null;
  });
  process.stdout.write(JSON.stringify({ found }));
});
