/*
 * Stylometry: zero-LLM statistical / stylometric AI-text scorer.
 *
 * Faithful JavaScript port of `service/scripts/score_stylometry.py` from
 * guillaumemeyer/watermarks-remover (MIT), upstream commit
 * 196ba9d168d3bdabd4fc7cba8e739f6e234cb6cc, file sha256
 * cd3dae134d5f641120218fd525afd523d4a0bfb52d4d73c0e92dc04e3bcc6d59, plus the
 * `classify_finding_confidence` helper from `service/scripts/common.py` that
 * `StylometryReport.to_dict()` calls. The marker table, sentence splitting,
 * sample (n-1) burstiness, Counter-based MATTR sliding window, sub-score
 * tiers, small-sample dampening, finding strings and 4-decimal rounding mirror
 * upstream so that `score(text).to_dict`-shaped output matches the Python
 * service for the same input. tests/test_stylometry_parity.py enforces that.
 *
 * Python `re` semantics are emulated explicitly because JS regexes differ:
 *  - `\w` (Unicode alnum + `_`) -> `[\p{L}\p{N}_]` (identical for Unicode 15.0;
 *    characters assigned later may differ by engine Unicode version),
 *  - `\b` (Unicode word boundary; JS `\b` is ASCII-only even with `u`) ->
 *    explicit lookarounds on the same class,
 *  - `\s` / `str.strip()` / `str.splitlines()` -> Python's exact whitespace and
 *    line-break sets (`\x1c-\x1f`, `\x85` included; U+FEFF excluded),
 *  - `re.IGNORECASE` -> `iu`, plus Python's extra `i` ~ `ı`/`İ` equivalence,
 *  - `round(x, 4)` and `f"{x:.2f}"` -> round-half-even on the exact binary
 *    value (JS `toFixed` rounds ties away from zero).
 *
 * Works as a plain <script> (exposes window.Stylometry) and as a CommonJS module.
 */
(function (root) {
  "use strict";

  const DEFAULT_THRESHOLD = 0.65;
  const MIN_SAMPLE_WORDS = 30;
  const FULL_WEIGHT_WORDS = 100;

  // (python_regex_pattern, human_label, weight) — verbatim from upstream.
  const AI_PHRASE_PATTERNS = [
    ["\\bdelve(?:s|d)?\\s+into\\b", "delve into", 1.2],
    ["\\ba\\s+testament\\s+to\\b", "a testament to", 1.1],
    ["\\brich\\s+tapestry(?:\\s+of)?\\b", "rich tapestry", 1.3],
    ["\\bplays?\\s+a\\s+(?:pivotal|crucial|vital|key)\\s+role\\b", "plays a pivotal/crucial role", 1.0],
    [
      "\\bin\\s+(?:today'?s|the)\\s+(?:(?:fast-paced|ever-evolving|digital|rapidly\\s+changing)\\s+)*(?:world|landscape|era|environment)\\b",
      "in today's fast-paced world/landscape",
      1.4,
    ],
    [
      "\\bit\\s+is\\s+(?:important|essential|crucial|worth\\s+noting)\\s+to\\s+(?:note|remember|consider|highlight)\\b",
      "it is important/crucial to note",
      0.9,
    ],
    [
      "\\bnot\\s+only\\b[\\w\\s,]+\\bbut\\s+(?:also\\s+)?(?:serves\\s+to|acts\\s+as|highlights)\\b",
      "not only ... but also serves to",
      0.8,
    ],
    [
      "\\bserve(?:s|d)?\\s+as\\s+a\\s+(?:beacon|reminder|catalyst|cornerstone)\\b",
      "serves as a beacon/catalyst/cornerstone",
      1.1,
    ],
    [
      "\\bunderscore(?:s|d)?\\s+the\\s+(?:importance|need|significance)\\b",
      "underscores the importance/need",
      0.9,
    ],
    [
      "\\bfoster(?:s|ing|ed)?\\s+a\\s+(?:sense|culture|deeper\\s+understanding)\\b",
      "fosters a sense/culture",
      0.9,
    ],
    [
      "\\bseamlessly\\s+(?:integrates?|integrated|blends?|combine[sd]?)\\b",
      "seamlessly integrates/blends",
      1.0,
    ],
    [
      "\\bnavigat(?:e|ing|es|ed)\\s+the\\s+(?:complexities|intricacies|nuances)\\b",
      "navigating the complexities/nuances",
      1.0,
    ],
    ["\\bmultifaceted\\s+(?:nature|approach|landscape)\\b", "multifaceted nature/approach", 1.0],
    ["\\bharness(?:ing|ed|es)?\\s+the\\s+power\\s+of\\b", "harnessing the power of", 1.0],
    ["\\ba\\s+myriad\\s+of\\b", "a myriad of", 0.8],
    ["\\bparadigm\\s+shift\\b", "paradigm shift", 0.9],
    ["\\bholistic\\s+(?:approach|view|perspective)\\b", "holistic approach/perspective", 0.9],
    ["\\bin\\s+conclusion\\b[,\\s]", "in conclusion", 0.8],
    ["\\bto\\s+summarize\\b[,\\s]", "to summarize", 0.8],
    ["\\bultimately\\b[,\\s]", "ultimately,", 0.6],
    ["\\bfurthermore\\b[,\\s]", "furthermore,", 0.6],
    ["\\bmoreover\\b[,\\s]", "moreover,", 0.6],
    ["\\bas\\s+an\\s+ai\\b", "as an AI", 1.5],
    ["\\bi\\s+hope\\s+this\\s+helps\\b", "I hope this helps", 1.2],
  ];

  // ---- Python `re` / str emulation -------------------------------------

  // Python (Unicode) `\w`: str.isalnum() or "_"  ==  \p{L} | \p{N} | _
  const W_CLASS = "\\p{L}\\p{N}_";
  // Python (Unicode) `\s` == str.isspace() set.
  const S_CLASS = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
  // Python `\b`: exactly one side of the position is a `\w` character.
  const B_BOUNDARY =
    "(?:(?<=[" + W_CLASS + "])(?![" + W_CLASS + "])|(?<![" + W_CLASS + "])(?=[" + W_CLASS + "]))";

  const RE_STRIP = new RegExp("^[" + S_CLASS + "]+|[" + S_CLASS + "]+$", "gu");
  const RE_SPLITLINES = /\r\n|[\n\v\f\r\x1c\x1d\x1e\x85\u2028\u2029]/u;
  const RE_ALL_SPACE = new RegExp("^[" + S_CLASS + "]*$", "u");

  /** Python str.strip() with no arguments. */
  function pyStrip(s) {
    return s.replace(RE_STRIP, "");
  }

  /** Python str.splitlines() (no keepends). */
  function pySplitlines(s) {
    if (s === "") return [];
    const parts = s.split(RE_SPLITLINES);
    // str.splitlines drops the empty tail produced by a trailing line break.
    if (parts.length && parts[parts.length - 1] === "") parts.pop();
    return parts;
  }

  /**
   * Translate an upstream Python-`re` pattern (the subset used by this module)
   * into an equivalent JS source string: `\b`, `\s`, `\w` get Python semantics,
   * and a literal `i` also matches `ı`/`İ` like Python's IGNORECASE does.
   */
  function translatePyPattern(src) {
    let out = "";
    let inClass = false;
    for (let k = 0; k < src.length; k++) {
      const c = src[k];
      if (c === "\\") {
        const n = src[k + 1];
        k++;
        if (n === "b") out += inClass ? "\\b" : B_BOUNDARY;
        else if (n === "s") out += inClass ? S_CLASS : "[" + S_CLASS + "]";
        else if (n === "w") out += inClass ? W_CLASS : "[" + W_CLASS + "]";
        else out += "\\" + n;
        continue;
      }
      if (c === "[" && !inClass) { inClass = true; out += c; continue; }
      if (c === "]" && inClass) { inClass = false; out += c; continue; }
      if (c === "i") { out += inClass ? "iıİ" : "[iıİ]"; continue; }
      out += c;
    }
    return out;
  }

  /** re.compile(pattern, re.IGNORECASE) equivalent (global, unicode). */
  function compilePy(src, ignoreCase) {
    return new RegExp(translatePyPattern(src), ignoreCase ? "giu" : "gu");
  }

  const RE_WORDS = compilePy("\\b[\\w'-]+\\b", false);
  // re.split(r"(?<=[.!?])\s+|\n+", ...)
  const RE_CHUNK_SPLIT = compilePy("(?<=[.!?])\\s+|\\n+", false);

  const MARKERS = AI_PHRASE_PATTERNS.map(([pattern, label, weight]) => ({
    pattern, label, weight, regex: compilePy(pattern, true),
  }));

  /**
   * Python-compatible fixed-point formatting: f"{x:.{digits}f}" — correctly
   * rounded from the exact binary value, ties to even (JS toFixed rounds exact
   * ties away from zero). Only non-negative finite inputs occur in this module.
   */
  function pyFixed(x, digits) {
    if (!Number.isFinite(x)) return String(x);
    const rounded = x.toFixed(digits);
    // toFixed(100) is the exact decimal expansion for any |x| < 1e21 whose
    // fraction has <= 100 digits (true for every value this module formats).
    const exact = Math.abs(x).toFixed(100);
    const tail = exact.slice(exact.indexOf(".") + 1 + digits);
    const isTie = tail[0] === "5" && /^0*$/.test(tail.slice(1));
    if (!isTie) return rounded;
    const last = rounded.charCodeAt(rounded.length - 1) - 48;
    if (last % 2 === 0) return rounded;
    // toFixed went up to an odd digit; Python wants the (even) truncation.
    const dot = exact.indexOf(".");
    return (x < 0 ? "-" : "") + exact.slice(0, digits > 0 ? dot + 1 + digits : dot);
  }

  /** Python round(x, ndigits) for floats. */
  function pyRound(x, ndigits) {
    if (!Number.isFinite(x)) return x;
    return Number.parseFloat(pyFixed(x, ndigits));
  }

  // ---- common.classify_finding_confidence (verbatim port) ---------------

  const CONFIRMED = [
    "c2patool reports", "c2pa-related manifest", "png chunk c2", "png chunk cabx",
    "png chunk jumb", "png chunk jumd", "jpeg app11 segment", "digital_source_type",
    "digitalsourcetype", "trainedalgorithmicmedia", "compositewithtrainedalgorithmicmedia",
    "softwareagent",
  ];
  const INFORMATIONAL = [
    "cms generator", "customxml parts", "xmp packet present", "unsupported",
    "not fully inspected", "format not", "svg <metadata> present", "not a valid",
    "truncated chunk", "bad segment length", "svg decode note",
  ];
  const PROBABLE = [
    "ai:", "marker:", "meta:", "frontmatter", "json-ld", "attr:", "png ", "jpeg app",
    "exif", "xmp", "interesting", "pdf-structured", "layer-a",
  ];

  function classifyFindingConfidence(finding) {
    const t = finding.toLowerCase();
    if (CONFIRMED.some((s) => t.includes(s))) return "confirmed";
    if (t.startsWith("info:") || INFORMATIONAL.some((s) => t.includes(s))) return "informational";
    if (t.includes("byte-scan")) return "likely_false_positive";
    if (PROBABLE.some((s) => t.includes(s))) return "probable";
    return "informational";
  }

  // ---- upstream functions ----------------------------------------------

  function extractSentences(text) {
    const cleanLines = [];
    let inCodeBlock = false;
    for (const line of pySplitlines(text)) {
      const trimmed = pyStrip(line);
      if (trimmed.startsWith("```")) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock || !trimmed) continue;
      cleanLines.push(trimmed);
    }
    const rawText = cleanLines.join("\n");
    if (RE_ALL_SPACE.test(rawText)) return [];
    const chunks = rawText.split(RE_CHUNK_SPLIT);
    const sentences = [];
    for (const c of chunks) {
      const s = pyStrip(c);
      if (s) sentences.push(s);
    }
    return sentences;
  }

  function extractWords(text) {
    const out = [];
    RE_WORDS.lastIndex = 0;
    for (const m of text.matchAll(RE_WORDS)) out.push(m[0].toLowerCase());
    return out;
  }

  /** Returns [mean_len, std_dev, cv|null]. */
  function computeBurstiness(sentences) {
    if (!sentences.length) return [0.0, 0.0, null];
    const lengths = sentences.map((s) => extractWords(s).length).filter((L) => L > 0);
    if (lengths.length < 2) {
      const meanLen = lengths.length ? lengths[0] : 0.0;
      return [meanLen, 0.0, null];
    }
    let sum = 0;
    for (const x of lengths) sum += x;
    const meanLen = sum / lengths.length;
    let sq = 0;
    for (const x of lengths) sq += (x - meanLen) * (x - meanLen);
    const variance = sq / (lengths.length - 1);
    const stdDev = Math.sqrt(variance);
    const cv = meanLen > 0 ? stdDev / meanLen : 0.0;
    return [meanLen, stdDev, cv];
  }

  function computeMattr(words, windowSize) {
    if (windowSize === undefined) windowSize = 50;
    const n = words.length;
    if (n === 0) return 0.0;
    if (n <= windowSize) return new Set(words).size / n;

    let totalTtr = 0.0;
    const numWindows = n - windowSize + 1;
    const current = new Map();
    for (let i = 0; i < windowSize; i++) current.set(words[i], (current.get(words[i]) || 0) + 1);
    totalTtr += current.size / windowSize;

    for (let i = 1; i < numWindows; i++) {
      const leaving = words[i - 1];
      const entering = words[i + windowSize - 1];
      const left = current.get(leaving) - 1;
      if (left === 0) current.delete(leaving);
      else current.set(leaving, left);
      current.set(entering, (current.get(entering) || 0) + 1);
      totalTtr += current.size / windowSize;
    }
    return totalTtr / numWindows;
  }

  function scanAiPhrases(text) {
    const matches = [];
    for (const mk of MARKERS) {
      const found = [];
      mk.regex.lastIndex = 0;
      for (const m of text.matchAll(mk.regex)) found.push(m[0]);
      if (found.length) {
        matches.push({ phrase: mk.label, count: found.length, weight: mk.weight, samples: found.slice(0, 3) });
      }
    }
    return matches;
  }

  function toDict(r) {
    return {
      path: r.path,
      word_count: r.word_count,
      sentence_count: r.sentence_count,
      burstiness_cv: r.burstiness_cv !== null ? pyRound(r.burstiness_cv, 4) : null,
      lexical_diversity: pyRound(r.lexical_diversity, 4),
      ai_ngram_density: pyRound(r.ai_ngram_density, 4),
      matched_markers: r.matched_markers,
      score: pyRound(r.score, 4),
      confidence_level: r.confidence_level,
      status: r.status,
      findings: r.findings,
      findings_confidence: r.findings.map(classifyFindingConfidence),
      notes: r.notes,
    };
  }

  /** score_text_stylometry(text, path).to_dict() */
  function score(text, options) {
    const path = options && options.path !== undefined ? options.path : "<text>";
    text = String(text == null ? "" : text);

    const words = extractWords(text);
    const wordCount = words.length;
    const sentences = extractSentences(text);
    const sentenceCount = sentences.length;
    const findings = [];
    const notes = [];

    // 1. Length guard
    if (wordCount < MIN_SAMPLE_WORDS) {
      const markerMatches = scanAiPhrases(text);
      for (const m of markerMatches) findings.push(`AI phrase marker '${m.phrase}' found (${m.count}x)`);
      notes.push(
        `Sample contains ${wordCount} words; statistical stylometry is uncalibrated below ${MIN_SAMPLE_WORDS} words`
      );
      return toDict({
        path, word_count: wordCount, sentence_count: sentenceCount, burstiness_cv: null,
        lexical_diversity: computeMattr(words), ai_ngram_density: 0.0,
        matched_markers: markerMatches, score: 0.0, confidence_level: "CLEAN",
        status: "insufficient_length", findings, notes,
      });
    }

    // 2. Metrics
    const cv = computeBurstiness(sentences)[2];
    const mattr = computeMattr(words);
    const markerMatches = scanAiPhrases(text);
    let totalMarkerWeight = 0;
    for (const m of markerMatches) totalMarkerWeight += m.count * m.weight;
    const ngramDensity = wordCount > 0 ? totalMarkerWeight / (wordCount / 100.0) : 0.0;

    // 3. Sub-scores
    let burstinessScore;
    if (cv === null) burstinessScore = null;
    else if (cv < 0.25) burstinessScore = 0.95;
    else if (cv < 0.35) burstinessScore = 0.80;
    else if (cv < 0.45) burstinessScore = 0.50;
    else if (cv < 0.55) burstinessScore = 0.25;
    else burstinessScore = 0.05;

    let ngramScore;
    if (ngramDensity >= 2.0) ngramScore = 1.0;
    else if (ngramDensity >= 1.0) ngramScore = 0.75;
    else if (ngramDensity >= 0.5) ngramScore = 0.45;
    else if (ngramDensity > 0) ngramScore = 0.20;
    else ngramScore = 0.0;

    const diversityScore = mattr >= 0.68 && mattr <= 0.76 ? 0.4 : 0.1;

    // 4. Composite & dampening
    let rawComposite;
    if (burstinessScore === null) {
      notes.push(
        "Sentence burstiness unavailable (fewer than 2 parsed sentences — e.g. body wrapped in a code fence); composite renormalized over AI-phrase density and lexical diversity"
      );
      rawComposite = ((ngramScore * 0.45) + (diversityScore * 0.10)) / 0.55;
    } else {
      rawComposite = (burstinessScore * 0.45) + (ngramScore * 0.45) + (diversityScore * 0.10);
    }

    let dampener;
    if (wordCount < FULL_WEIGHT_WORDS) {
      dampener = 0.4 + 0.6 * ((wordCount - MIN_SAMPLE_WORDS) / (FULL_WEIGHT_WORDS - MIN_SAMPLE_WORDS));
      notes.push(
        `Sample word count (${wordCount}) is in calibration range (${MIN_SAMPLE_WORDS}-${FULL_WEIGHT_WORDS}); score dampened by factor ${pyFixed(dampener, 2)}`
      );
    } else {
      dampener = 1.0;
    }

    const finalScore = Math.min(1.0, Math.max(0.0, rawComposite * dampener));

    // 5. Findings & confidence tier
    for (const m of markerMatches) findings.push(`AI cadence phrase '${m.phrase}' (${m.count}x)`);
    if (cv !== null && cv < 0.35 && sentenceCount >= 3) {
      findings.push(`Unnaturally uniform sentence cadence (CV=${pyFixed(cv, 2)} < 0.35)`);
    }
    if (ngramDensity >= 1.0) {
      findings.push(`Elevated AI formulaic transition density (${pyFixed(ngramDensity, 2)}/100w)`);
    }

    let confidence;
    if (finalScore >= 0.75) confidence = "HIGH";
    else if (finalScore >= 0.50) confidence = "MEDIUM";
    else if (finalScore >= 0.25) confidence = "LOW";
    else confidence = "CLEAN";

    return toDict({
      path, word_count: wordCount, sentence_count: sentenceCount, burstiness_cv: cv,
      lexical_diversity: mattr, ai_ngram_density: ngramDensity, matched_markers: markerMatches,
      score: finalScore, confidence_level: confidence, status: "ok", findings, notes,
    });
  }

  const api = {
    score,
    extractSentences,
    extractWords,
    computeBurstiness,
    computeMattr,
    scanAiPhrases,
    classifyFindingConfidence,
    translatePyPattern,
    pyFixed,
    pyRound,
    DEFAULT_THRESHOLD,
    MIN_SAMPLE_WORDS,
    FULL_WEIGHT_WORDS,
    AI_PHRASE_PATTERNS,
  };
  root.Stylometry = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
