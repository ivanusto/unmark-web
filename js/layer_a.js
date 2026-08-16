/*
 * Layer A: invisible Unicode / homoglyph-space detection and cleaning.
 *
 * Faithful JavaScript port of `service/scripts/text_unicode.py` from
 * guillaumemeyer/watermarks-remover (MIT). The decision procedure (`decide`),
 * the "load-bearing invisible" preservation rules (emoji glue, CJK/Mongolian
 * variation selectors, script joiners, complete flag tag sequences, Mongolian
 * FVS, Khmer inherent vowels, Hangul fillers, RTL directional marks and paired
 * embeddings, orthographic Arabic/Syriac Cf marks) and the Cf catch-all mirror
 * upstream so that browser output matches the Python service byte-for-byte for
 * the same options. tests/test_layer_a_parity.py enforces that.
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
  // Directional marks and isolates are legitimate in mixed RTL/LTR prose:
  // inspect them, but preserve them during the default clean. Embeddings and
  // overrides stay destructive by default — they can reorder unrelated spans.
  const PRESERVABLE_BIDI_CPS = new Set([0x061c, 0x200e, 0x200f, 0x2066, 0x2067, 0x2068, 0x2069]);
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
    if (cp >= 0x2190 && cp <= 0x25ff) return true; // arrows, technical, enclosed symbols
    if (cp >= 0x2600 && cp <= 0x27bf) return true;
    if (cp >= 0x2b00 && cp <= 0x2bff) return true;
    if (cp === 0x00a9 || cp === 0x00ae || cp === 0x2122 || cp === 0x3030 || cp === 0x303d || cp === 0x3297 || cp === 0x3299) return true;
    if (cp === 0x23 || cp === 0x2a || (cp >= 0x30 && cp <= 0x39)) return true;
    return false;
  }

  const cat = (cp) => String.fromCodePoint(cp);

  const JOINING_SCRIPTS = [
    [0x0600, 0x08ff, "arabic"],
    [0x0900, 0x0dff, "indic"],
    [0x0f00, 0x109f, "south-asian"],
    [0x1780, 0x17ff, "khmer"],
    [0x1800, 0x18af, "mongolian"],
  ];
  /** Broad script group where ZWJ/ZWNJ can be orthographic, else null. */
  function joiningScript(cp) {
    for (const [start, end, name] of JOINING_SCRIPTS) {
      if (cp >= start && cp <= end && RE_LM.test(cat(cp))) return name;
    }
    return null;
  }

  const isCjkIdeograph = (cp) =>
    (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x20000 && cp <= 0x323af);
  const isMongolianBase = (cp) => cp >= 0x1800 && cp <= 0x18af;
  const isVariationSelector = (cp) =>
    inVsSupplement(cp) || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x180b && cp <= 0x180d);

  const isMongolianLetter = (cp) => cp >= 0x1800 && cp <= 0x18af && RE_L.test(cat(cp));
  const isKhmerLetter = (cp) => cp >= 0x1780 && cp <= 0x17ff && RE_L.test(cat(cp));
  const isHangulJamo = (cp) =>
    (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0xa960 && cp <= 0xa97c) || (cp >= 0xd7b0 && cp <= 0xd7c6);

  function isGlue(cp) {
    return EMOJI_GLUE.has(cp) || isVariationSelector(cp) || SCRIPT_JOINERS.has(cp) || inTagRange(cp) ||
      MONGOLIAN_FVS.has(cp) || KHMER_VOWELS.has(cp) || HANGUL_FILLERS.has(cp);
  }

  /** Code-point indices inside complete subdivision-flag tag sequences. */
  function validFlagTagIndices(cps) {
    const valid = new Set();
    let i = 0;
    while (i < cps.length) {
      if (cps[i] !== 0x1f3f4) { i++; continue; } // waving black flag
      let j = i + 1;
      while (j < cps.length && cps[j] >= 0xe0020 && cps[j] <= 0xe007e) j++;
      if (j > i + 1 && j < cps.length && cps[j] === 0xe007f) {
        for (let k = i + 1; k <= j; k++) valid.add(k);
        i = j + 1;
      } else {
        i++;
      }
    }
    return valid;
  }

  /** Indices belonging to complete LRE/RLE … PDF pairs, excluding overrides. */
  function validBidiEmbeddingIndices(cps) {
    const valid = new Set();
    const stack = [];
    for (let index = 0; index < cps.length; index++) {
      const cp = cps[index];
      if (cp === 0x202a || cp === 0x202b || cp === 0x202d || cp === 0x202e) {
        stack.push([cp, index]);
      } else if (cp === 0x202c) {
        if (!stack.length) continue;
        const [opener, openerIndex] = stack.pop();
        if (opener === 0x202a || opener === 0x202b) { valid.add(openerIndex); valid.add(index); }
      }
    }
    return valid;
  }

  /**
   * Classify one code point. Returns [action, outChar, kind] where action is
   * "keep" | "strip" | "replace" and kind is null when not suspicious.
   * prevKeptCp is the last non-glue survivor; prevInputCp/nextInputCp are the
   * raw neighbours (null at the edges).
   */
  function decide(cp, prevKeptCp, prevInputCp, nextInputCp, opts) {
    const { validFlagTag, validBidiEmbedding, normalizeSpaces, treatConfusables, stripEmojiGlue, stripBidi } = opts;
    if (validBidiEmbedding && !stripBidi) return ["keep", cat(cp), null];
    if (PRESERVABLE_BIDI_CPS.has(cp) && !stripBidi) return ["keep", cat(cp), null];
    if (prevInputCp !== null && !stripEmojiGlue) {
      if (inVsSupplement(cp) && isCjkIdeograph(prevInputCp)) return ["keep", cat(cp), null];
      if (cp >= 0x180b && cp <= 0x180d && isMongolianBase(prevInputCp)) return ["keep", cat(cp), null];
      if (cp >= 0xfe00 && cp <= 0xfe0d && isCjkIdeograph(prevInputCp)) return ["keep", cat(cp), null];
    }
    if (EMOJI_GLUE.has(cp) && !stripEmojiGlue) {
      if ((cp === 0xfe0e || cp === 0xfe0f) && prevInputCp !== null && isEmojiBase(prevInputCp)) return ["keep", cat(cp), null];
      if (cp === 0x200d && prevKeptCp !== null && nextInputCp !== null &&
          isEmojiBase(prevKeptCp) && isEmojiBase(nextInputCp)) return ["keep", cat(cp), null];
    }
    if (!stripEmojiGlue) {
      if (SCRIPT_JOINERS.has(cp) && prevInputCp !== null && nextInputCp !== null) {
        const prevScript = joiningScript(prevInputCp);
        const nextScript = joiningScript(nextInputCp);
        if (prevScript !== null && prevScript === nextScript) return ["keep", cat(cp), null];
      }
      if (inTagRange(cp) && validFlagTag) return ["keep", cat(cp), null];
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

  /*
   * Total size of the matching blocks difflib.SequenceMatcher(None, a, b,
   * autojunk=False) would produce. Upstream counts NFKC-changed input
   * characters as the non-equal opcodes on the `a` side, which is exactly
   * a.length minus this total, so the whole opcode list is never needed.
   */
  function matchingSize(a, b) {
    const b2j = new Map();
    for (let j = 0; j < b.length; j++) {
      let list = b2j.get(b[j]);
      if (!list) { list = []; b2j.set(b[j], list); }
      list.push(j);
    }
    function findLongestMatch(alo, ahi, blo, bhi) {
      let besti = alo, bestj = blo, bestsize = 0;
      let j2len = new Map();
      for (let i = alo; i < ahi; i++) {
        const newj2len = new Map();
        const js = b2j.get(a[i]);
        if (js) {
          for (const j of js) {
            if (j < blo) continue;
            if (j >= bhi) break;
            const k = (j2len.get(j - 1) || 0) + 1;
            newj2len.set(j, k);
            if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
          }
        }
        j2len = newj2len;
      }
      while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) { besti--; bestj--; bestsize++; }
      while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) bestsize++;
      return [besti, bestj, bestsize];
    }
    let total = 0;
    const queue = [[0, a.length, 0, b.length]];
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop();
      const [i, j, k] = findLongestMatch(alo, ahi, blo, bhi);
      if (k) {
        total += k;
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
    }
    return total;
  }

  const toCps = (s) => Array.from(s, (c) => c.codePointAt(0));

  /**
   * clean(text, {nfkc, aggressiveHomoglyphs, normalizeSpaces, stripEmojiGlue, stripBidi})
   * -> { cleaned, stats } — stats mirrors upstream clean_text().
   */
  function clean(text, options) {
    const o = Object.assign(
      { nfkc: false, aggressiveHomoglyphs: false, normalizeSpaces: true, stripEmojiGlue: false, stripBidi: false },
      options || {},
    );
    const removed = new Map();
    const replaced = new Map();
    const out = [];
    let prevKept = null;
    const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
    const cps = toCps(text);
    const validFlagTags = validFlagTagIndices(cps);
    const validBidiEmbeddings = validBidiEmbeddingIndices(cps);
    for (let i = 0; i < cps.length; i++) {
      const cp = cps[i];
      const [action, outChar] = decide(cp, prevKept, i > 0 ? cps[i - 1] : null, i + 1 < cps.length ? cps[i + 1] : null, {
        validFlagTag: validFlagTags.has(i),
        validBidiEmbedding: validBidiEmbeddings.has(i),
        normalizeSpaces: o.normalizeSpaces,
        treatConfusables: o.aggressiveHomoglyphs,
        stripEmojiGlue: o.stripEmojiGlue,
        stripBidi: o.stripBidi,
      });
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
    let nfkcChanged = false;
    if (o.nfkc) {
      const before = result;
      result = result.normalize("NFKC");
      if (result !== before) {
        nfkcChanged = true;
        const a = toCps(before);
        const changedInputs = a.length - matchingSize(a, toCps(result));
        replaced.set("NFKC_normalize", changedInputs || 1);
      }
    }
    let removedCount = 0; for (const v of removed.values()) removedCount += v;
    let replacedCount = 0; for (const v of replaced.values()) replacedCount += v;
    return {
      cleaned: result,
      stats: {
        input_length: cps.length,
        output_length: cpLen(result),
        removed: Object.fromEntries(removed),
        replaced: Object.fromEntries(replaced),
        removed_count: removedCount,
        replaced_count: replacedCount,
        nfkc_changed: nfkcChanged,
      },
    };
  }

  function cpLen(s) { let n = 0; for (const _ of s) n++; return n; }

  /**
   * inspect(text, {aggressive, stripEmojiGlue}) -> report shaped like
   * upstream TextInspectReport.to_dict(). Bidi controls are always reported,
   * even though clean() preserves the legitimate ones by default.
   */
  function inspect(text, options) {
    const o = Object.assign({ aggressive: false, stripEmojiGlue: false }, options || {});
    const buckets = new Map(); // key "cp:kind" -> {cp, kind, offsets[]}
    let prevKept = null;
    const cps = toCps(text);
    const validFlagTags = validFlagTagIndices(cps);
    const validBidiEmbeddings = validBidiEmbeddingIndices(cps);
    for (let i = 0; i < cps.length; i++) {
      const cp = cps[i];
      const [action, outChar, kind] = decide(cp, prevKept, i > 0 ? cps[i - 1] : null, i + 1 < cps.length ? cps[i + 1] : null, {
        validFlagTag: validFlagTags.has(i),
        validBidiEmbedding: validBidiEmbeddings.has(i),
        normalizeSpaces: true,
        treatConfusables: o.aggressive,
        stripEmojiGlue: o.stripEmojiGlue,
        stripBidi: true,
      });
      if (kind === null) {
        if (!isGlue(cp)) prevKept = cp;
        continue;
      }
      const key = cp + ":" + kind;
      let b = buckets.get(key);
      if (!b) { b = { cp, kind, offsets: [] }; buckets.set(key, b); }
      b.offsets.push(i);
      if (action === "replace") prevKept = outChar.codePointAt(0);
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
    return { length: cps.length, suspicious_total: total, hits, notes };
  }

  const api = { clean, inspect, decide, isGlue, charLabel, STRIP_CODEPOINTS, SPACE_HOMOGLYPHS, LATIN_CONFUSABLES };
  root.LayerA = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
