#!/usr/bin/env node
// Test shim for js/zh_style.js. On stdin: {"text":...} -> {"report":..., "sentences":[...], "applies":bool,
// "folded_len":n, "input_len":n}. Used by tests/test_zh_style.py.
const path = require("path");
const ZhStyle = require(path.join(__dirname, "..", "js", "zh_style.js"));
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  const { text } = JSON.parse(raw);
  const report = ZhStyle.score(text);
  process.stdout.write(JSON.stringify({
    report,
    sentences: ZhStyle.residualSentences(text, report, 12),
    applies: ZhStyle.applies(text),
    folded_len: ZhStyle.fold(text).length,
    input_len: text.length,
    // the original-text slice of every span, so the test need not count UTF-16 units itself
    span_texts: report.spans.map((s) => text.slice(s.start, s.end)),
  }));
});
