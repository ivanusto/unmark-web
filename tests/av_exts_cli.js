#!/usr/bin/env node
// Print the audio/video extension list each side owns: the engine's, and the
// page's own copy, which exists so routing a dropped file needs no engine.
const fs = require("fs");
const path = require("path");
const AvMeta = require("../js/av_meta.js");

const app = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
const m = app.match(/const AV_EXT = new Set\(\[([^\]]*)\]\)/);
const page = m ? m[1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean) : null;
process.stdout.write(JSON.stringify({ engine: AvMeta.AV_EXTS, page }));
