/*
 * Layer A: invisible Unicode / homoglyph-space detection and cleaning.
 *
 * Faithful JavaScript port of `service/scripts/text_unicode.py` from
 * guillaumemeyer/watermarks-remover (MIT). The decision procedure (`decide`),
 * the "load-bearing invisible" preservation rules (emoji glue, script joiners,
 * flag tag chars, Mongolian FVS, Khmer inherent vowels, Hangul fillers,
 * orthographic Arabic/Syriac Cf marks) and the Cf catch-all mirror upstream so
 * that browser output matches the Python service byte-for-byte for the same
 * options. tests/test_layer_a_parity.py enforces that.
 *
 * Works as a plain <script> (exposes window.LayerA) and as a CommonJS module.
 */
(function (root) {
  "use strict";

  const STRIP_CODEPOINTS = new Set([
    0x00ad, 0x034f, 0x061c, 0x115f, 0x1160, 0x17b4, 0x17b5,
    0x180b, 0x180c, 0x180d, 0x180e,
    0x200b, 0x200c, 0x200d, 0x200e, 0x200f,
    0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
    0x2060, 0x2061, 0x2062, 0x2063, 0x2064,
    0x2066, 0x2067, 0x2068, 0x2069,
    0x206a, 0x206b, 0x206c, 0x206d, 0x206e, 0x206f,
    0xfeff,
    0xfe00, 0xfe01, 0xfe02, 0xfe03, 0xfe04, 0xfe05, 0xfe06, 0xfe07,
    0xfe08, 0xfe09, 0xfe0a, 0xfe0b, 0xfe0c, 0xfe0d, 0xfe0e, 0xfe0f,
    0xfff9, 0xfffa, 0xfffb,
  ]);

  const SPACE_HOMOGLYPHS = new Map([
    [0x00a0, " "], [0x1680, " "], [0x2000, " "], [0x2001, " "], [0x2002, " "],
    [0x2003, " "], [0x2004, " "], [0x2005, " "], [0x2006, " "], [0x2007, " "],
    [0x2008, " "], [0x2009, " "], [0x200a, " "], [0x202f, " "], [0x205f, " "],
    [0x3000, " "],
  ]);

  const LATIN_CONFUSABLES = new Map([
    [0x0410, "A"], [0x0412, "B"], [0x0415, "E"], [0x041a, "K"], [0x041c, "M"],
    [0x041d, "H"], [0x041e, "O"], [0x0420, "P"], [0x0421, "C"], [0x0422, "T"],
    [0x0425, "X"], [0x0430, "a"], [0x0435, "e"], [0x043e, "o"], [0x0440, "p"],
    [0x0441, "c"], [0x0443, "y"], [0x0445, "x"], [0x0456, "i"],
  ]);
  for (let i = 0; i < 26; i++) {
    LATIN_CONFUSABLES.set(0xff21 + i, String.fromCharCode(0x41 + i)); // fullwidth A-Z
    LATIN_CONFUSABLES.set(0xff41 + i, String.fromCharCode(0x61 + i)); // fullwidth a-z
  }

  const BIDI_CPS = new Set([
    0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
    0x2066, 0x2067, 0x2068, 0x2069,
  ]);
  const ZW_FAMILY = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x180e]);

  const EMOJI_GLUE = new Set([0x200d, 0xfe0e, 0xfe0f]);
  const SCRIPT_JOINERS = new Set([0x200c, 0x200d]);
  const ORTHOGRAPHIC_CF = new Set([
    0x0600, 0x0601, 0x0602, 0x0603, 0x0604, 0x0605, 0x06dd, 0x070f, 0x08e2,
    0x110bd, 0x110cd,
  ]);
  const MONGOLIAN_FVS = new Set([0x180b, 0x180c, 0x180d]);
  const KHMER_VOWELS = new Set([0x17b4, 0x17b5]);
  const HANGUL_FILLERS = new Set([0x115f, 0x1160]);

  const RE_CF = /^\p{Cf}$/u;
  const RE_LM = /^[\p{L}\p{M}]$/u;
  const RE_L = /^\p{L}$/u;

  const inVsSupplement = (cp) => cp >= 0xe0100 && cp <= 0xe01ef;
  const inTagRange = (cp) => cp >= 0xe0020 && cp <= 0xe007f;
  const isPrivateUse = (cp) =>
    (cp >= 0xe000 && cp <= 0xf8ff) || (cp >= 0xf0000 && cp <= 0xffffd) || (cp >= 0x100000 && cp <= 0x10fffd);

  function isStripCp(cp) {
    return STRIP_CODEPOINTS.has(cp) || inVsSupplement(cp) || (cp >= 0xe0001 && cp <= 0xe007f) || isPrivateUse(cp);
  }

  function stripKind(cp) {
    if (cp >= 0xe0001 && cp <= 0xe007f) return "tag_chars";
    if (inVsSupplement(cp) || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x180b && cp <= 0x180d)) return "variation_selector";
    if (BIDI_CPS.has(cp)) return "bidi";
    if (ZW_FAMILY.has(cp)) return "zwj_family";
    if (isPrivateUse(cp)) return "private_use";
    return "strip";
  }

  function isEmojiBase(cp) {
    if (cp >= 0x1f000 && cp <= 0x1faff) return true;
    if (cp >= 0x2600 && cp <= 0x27bf) return true;
    if (cp >= 0x2b00 && cp <= 0x2bff) return true;
    if (cp === 0x00a9 || cp === 0x00ae || cp === 0x2122 || cp === 0x3030 || cp === 0x303d || cp === 0x3297 || cp === 0x3299) return true;
    if (cp === 0x23 || cp === 0x2a || (cp >= 0x30 && cp <= 0x39)) return true;
    return false;
  }

  const cat = (cp) => String.fromCodePoint(cp);
  const isJoiningLetter = (cp) => cp > 0x7f && RE_LM.test(cat(cp));
  const isMongolianLetter = (cp) => cp >= 0x1800 && cp <= 0x18af && RE_L.test(cat(cp));
  const isKhmerLetter = (cp) => cp >= 0x1780 && cp <= 0x17ff && RE_L.test(cat(cp));
  const isHangulJamo = (cp) =>
    (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0xa960 && cp <= 0xa97c) || (cp >= 0xd7b0 && cp <= 0xd7c6);

  function isGlue(cp) {
    return EMOJI_GLUE.has(cp) || SCRIPT_JOINERS.has(cp) || inTagRange(cp) ||
      MONGOLIAN_FVS.has(cp) || KHMER_VOWELS.has(cp) || HANGUL_FILLERS.has(cp);
  }

  /**
   * Classify one code point. Returns [action, outChar, kind] where action is
   * "keep" | "strip" | "replace" and kind is null when not suspicious.
   */
  function decide(cp, prevKeptCp, opts) {
    const { normalizeSpaces, treatConfusables, stripEmojiGlue } = opts;
    if (EMOJI_GLUE.has(cp) && !stripEmojiGlue) {
      if (prevKeptCp !== null && isEmojiBase(prevKeptCp)) return ["keep", cat(cp), null];
    }
    if (!stripEmojiGlue) {
      if (SCRIPT_JOINERS.has(cp) && prevKeptCp !== null && isJoiningLetter(prevKeptCp)) return ["keep", cat(cp), null];
      if (inTagRange(cp) && prevKeptCp !== null && isEmojiBase(prevKeptCp)) return ["keep", cat(cp), null];
      if (MONGOLIAN_FVS.has(cp) && prevKeptCp !== null && isMongolianLetter(prevKeptCp)) return ["keep", cat(cp), null];
      if (KHMER_VOWELS.has(cp) && prevKeptCp !== null && isKhmerLetter(prevKeptCp)) return ["keep", cat(cp), null];
      if (HANGUL_FILLERS.has(cp) && prevKeptCp !== null && isHangulJamo(prevKeptCp)) return ["keep", cat(cp), null];
      if (ORTHOGRAPHIC_CF.has(cp)) return ["keep", cat(cp), null];
    }
    if (isStripCp(cp)) return ["strip", "", stripKind(cp)];
    if (normalizeSpaces && SPACE_HOMOGLYPHS.has(cp)) return ["replace", SPACE_HOMOGLYPHS.get(cp), "space"];
    if (treatConfusables && LATIN_CONFUSABLES.has(cp)) return ["replace", LATIN_CONFUSABLES.get(cp), "confusable"];
    if (RE_CF.test(cat(cp)) && !SPACE_HOMOGLYPHS.has(cp)) return ["strip", "", "other_cf"];
    return ["keep", cat(cp), null];
  }

  const NAMES = {
    0x00ad: "SOFT HYPHEN", 0x034f: "COMBINING GRAPHEME JOINER", 0x061c: "ARABIC LETTER MARK",
    0x180e: "MONGOLIAN VOWEL SEPARATOR", 0x200b: "ZERO WIDTH SPACE", 0x200c: "ZERO WIDTH NON-JOINER",
    0x200d: "ZERO WIDTH JOINER", 0x200e: "LEFT-TO-RIGHT MARK", 0x200f: "RIGHT-TO-LEFT MARK",
    0x202a: "LEFT-TO-RIGHT EMBEDDING", 0x202b: "RIGHT-TO-LEFT EMBEDDING", 0x202c: "POP DIRECTIONAL FORMATTING",
    0x202d: "LEFT-TO-RIGHT OVERRIDE", 0x202e: "RIGHT-TO-LEFT OVERRIDE", 0x2060: "WORD JOINER",
    0x2061: "FUNCTION APPLICATION", 0x2062: "INVISIBLE TIMES", 0x2063: "INVISIBLE SEPARATOR",
    0x2064: "INVISIBLE PLUS", 0x2066: "LEFT-TO-RIGHT ISOLATE", 0x2067: "RIGHT-TO-LEFT ISOLATE",
    0x2068: "FIRST STRONG ISOLATE", 0x2069: "POP DIRECTIONAL ISOLATE", 0xfeff: "ZERO WIDTH NO-BREAK SPACE",
    0xfe0e: "VARIATION SELECTOR-15", 0xfe0f: "VARIATION SELECTOR-16",
    0x00a0: "NO-BREAK SPACE", 0x2009: "THIN SPACE", 0x200a: "HAIR SPACE", 0x202f: "NARROW NO-BREAK SPACE",
    0x3000: "IDEOGRAPHIC SPACE", 0x2002: "EN SPACE", 0x2003: "EM SPACE",
  };
  const hex = (cp) => "U+" + cp.toString(16).toUpperCase().padStart(4, "0");
  function charLabel(cp) {
    let name = NAMES[cp];
    if (!name) {
      if (cp >= 0xfe00 && cp <= 0xfe0f) name = "VARIATION SELECTOR-" + (cp - 0xfe00 + 1);
      else if (inVsSupplement(cp)) name = "VARIATION SELECTOR-" + (cp - 0xe0100 + 17);
      else if (inTagRange(cp) || cp === 0xe0001) name = "TAG CHARACTER";
      else if (isPrivateUse(cp)) name = "PRIVATE USE";
      else if (LATIN_CONFUSABLES.has(cp)) name = "CONFUSABLE OF '" + LATIN_CONFUSABLES.get(cp) + "'";
      else name = "UNKNOWN";
    }
    return hex(cp) + " " + name;
  }
  const hitConfidence = (kind) => (kind === "space" ? "informational" : "probable");

  /**
   * clean(text, {nfkc, aggressiveHomoglyphs, normalizeSpaces, stripEmojiGlue})
   * -> { cleaned, stats } — stats mirrors upstream clean_text().
   */
  function clean(text, options) {
    const o = Object.assign({ nfkc: false, aggressiveHomoglyphs: false, normalizeSpaces: true, stripEmojiGlue: false }, options || {});
    const removed = new Map();
    const replaced = new Map();
    const out = [];
    let prevKept = null;
    let inputLength = 0;
    const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
    const dopts = { normalizeSpaces: o.normalizeSpaces, treatConfusables: o.aggressiveHomoglyphs, stripEmojiGlue: o.stripEmojiGlue };
    for (const ch of text) {
      inputLength++;
      const cp = ch.codePointAt(0);
      const [action, outChar] = decide(cp, prevKept, dopts);
      if (action === "keep") {
        out.push(outChar);
        if (!isGlue(cp)) prevKept = cp;
      } else if (action === "replace") {
        out.push(outChar);
        bump(replaced, charLabel(cp));
        prevKept = outChar.codePointAt(0);
      } else {
        bump(removed, charLabel(cp));
      }
    }
    let result = out.join("");
    let nfkcDelta = 0;
    if (o.nfkc) {
      const before = result;
      result = result.normalize("NFKC");
      if (result !== before) {
        nfkcDelta = Math.abs(cpLen(before) - cpLen(result)) || 1;
        replaced.set("NFKC_normalize", nfkcDelta);
      }
    }
    let removedCount = 0; for (const v of removed.values()) removedCount += v;
    let replacedCount = 0; for (const [k, v] of replaced) if (k !== "NFKC_normalize") replacedCount += v;
    return {
      cleaned: result,
      stats: {
        input_length: inputLength,
        output_length: cpLen(result),
        removed: Object.fromEntries(removed),
        replaced: Object.fromEntries(replaced),
        removed_count: removedCount,
        replaced_count: replacedCount,
      },
    };
  }

  function cpLen(s) { let n = 0; for (const _ of s) n++; return n; }

  /**
   * inspect(text, {aggressive, stripEmojiGlue}) -> report shaped like
   * upstream TextInspectReport.to_dict().
   */
  function inspect(text, options) {
    const o = Object.assign({ aggressive: false, stripEmojiGlue: false }, options || {});
    const buckets = new Map(); // key "cp:kind" -> {cp, kind, offsets[]}
    let prevKept = null;
    let i = 0;
    const dopts = { normalizeSpaces: true, treatConfusables: o.aggressive, stripEmojiGlue: o.stripEmojiGlue };
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      const [action, outChar, kind] = decide(cp, prevKept, dopts);
      if (kind === null) {
        if (!isGlue(cp)) prevKept = cp;
        i++;
        continue;
      }
      const key = cp + ":" + kind;
      let b = buckets.get(key);
      if (!b) { b = { cp, kind, offsets: [] }; buckets.set(key, b); }
      b.offsets.push(i);
      if (action === "replace") prevKept = outChar.codePointAt(0);
      i++;
    }
    const hits = [...buckets.values()]
      .sort((a, b) => (b.offsets.length - a.offsets.length) || (a.cp - b.cp))
      .map((b) => ({
        codepoint: hex(b.cp),
        label: charLabel(b.cp),
        count: b.offsets.length,
        kind: b.kind,
        confidence: hitConfidence(b.kind),
        sample_offsets: b.offsets.slice(0, 10),
      }));
    const total = hits.reduce((n, h) => n + h.count, 0);
    const notes = [
      "Layer A only: invisible/format Unicode and space homoglyphs (edit-based carriers).",
      "Statistical (token-sampling) watermarks are not detectable here; use Layer B rewrite.",
    ];
    if (!hits.length) notes.push("No deterministic Layer A (invisible Unicode/format) carriers detected.");
    return { length: i, suspicious_total: total, hits, notes };
  }

  const api = { clean, inspect, decide, isGlue, charLabel, STRIP_CODEPOINTS, SPACE_HOMOGLYPHS, LATIN_CONFUSABLES };
  root.LayerA = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
