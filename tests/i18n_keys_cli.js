#!/usr/bin/env node
// Test shim: print {"dict": {lang: [keys]}, "used": [keys used in index.html]}.
// The dictionary is a module-private object, so it is exposed by patching the
// export line rather than by adding a debug hook to shipping code.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(root, "js", "i18n.js"), "utf8")
  .replace("  root.I18n = {", "  root.__dict = dict;\n  root.I18n = {");
const ctx = vm.createContext({
  document: { documentElement: {}, querySelectorAll: () => [], addEventListener: () => {}, title: "" },
  navigator: { languages: ["en"] },
  localStorage: { getItem: () => null, setItem: () => {} },
  addEventListener: () => {},
});
ctx.window = ctx;
vm.runInContext(src, ctx);

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const used = new Set();
for (const m of html.matchAll(/data-i18n(?:-title|-placeholder|-content|-html)?="([^"]+)"/g)) used.add(m[1]);

process.stdout.write(JSON.stringify({
  dict: Object.fromEntries(Object.entries(ctx.__dict).map(([lang, d]) => [lang, Object.keys(d)])),
  used: [...used],
}));
