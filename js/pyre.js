/*
 * Python `re` and `str` semantics, for ports that have to match CPython
 * exactly rather than approximately.
 *
 * JS regexes differ from Python's in ways that change what a ported cleaner
 * keeps and removes:
 *  - `\w` (Unicode alnum + `_`) -> `[\p{L}\p{N}_]` (identical for Unicode 15.0;
 *    characters assigned later may differ by engine Unicode version),
 *  - `\b` (Unicode word boundary; JS `\b` is ASCII-only even with `u`) ->
 *    explicit lookarounds on the same class,
 *  - `\s` / `str.strip()` / `str.splitlines()` -> Python's exact whitespace and
 *    line-break sets (`\x1c-\x1f`, `\x85` included; U+FEFF excluded),
 *  - `re.IGNORECASE` -> `iu`, plus Python's extra `i` ~ `ı`/`İ` equivalence.
 *
 * This lived inside js/stylometry.js until a second port needed the same
 * rules. It is the same code, moved: the stylometry parity suite is what says
 * so, since every one of its marker patterns goes through compilePy().
 *
 * Works as a plain <script> (exposes window.PyRe) and as a CommonJS module.
 */
(function (root) {
  "use strict";

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
   * and under IGNORECASE a literal `i` also matches `ı`/`İ`, like CPython's
   * case folding does.
   */
  function translatePyPattern(src, ignoreCase) {
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
      // Only under IGNORECASE. A case-sensitive Python pattern matches "i" and
      // nothing else, so widening it there would quietly match Turkish text
      // that CPython does not.
      if ((c === "i" || c === "I") && ignoreCase) { out += inClass ? "iıİ" : "[iıİ]"; continue; }
      out += c;
    }
    return out;
  }

  /** re.compile(pattern, re.IGNORECASE) equivalent (global, unicode). */
  function compilePy(src, ignoreCase) {
    return new RegExp(translatePyPattern(src, ignoreCase), ignoreCase ? "giu" : "gu");
  }

  const RE_ALNUM_CHAR = /^[\p{L}\p{N}]$/u;
  const RE_SPACE_CHAR = new RegExp("^[" + S_CLASS + "]$", "u");

  /** Python str.isalnum() for a single character (letters and numerics, no "_"). */
  function pyIsAlnum(ch) {
    return RE_ALNUM_CHAR.test(ch);
  }

  /** Python str.isspace() for a single character. */
  function pyIsSpace(ch) {
    return RE_SPACE_CHAR.test(ch);
  }

  const api = { W_CLASS, S_CLASS, B_BOUNDARY, translatePyPattern, compilePy, pyStrip, pySplitlines,
    pyIsAlnum, pyIsSpace, RE_ALL_SPACE };
  root.PyRe = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
