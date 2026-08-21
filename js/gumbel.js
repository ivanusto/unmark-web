/*
 * Keyed-Gumbel (Aaronson EXP) text-watermark detection, entirely in the browser.
 *
 * Faithful JavaScript port of `service/scripts/detect_gumbel.py` from
 * guillaumemeyer/watermarks-remover (MIT). The scheme replays the keyed
 * sampler's noise from the text alone and tests whether the observed tokens
 * look like winners of keyed draws:
 *
 *     seed = HMAC(key, last H tokens)     H = 4 by default
 *     u_t  = HMAC(seed, token_t)          replayable from the text alone
 *     S    = sum_t -log(1 - u_t)          ~ Gamma(counted, 1) under the null
 *     p    = P(Gamma(counted, 1) >= S)    exact for an integer shape
 *
 * Repeated context windows are masked: the generator falls back to ordinary
 * randomness when a window recurs, so the detector applies the same skip rule
 * and reused windows contribute no evidence. Positions with fewer than H
 * preceding tokens have no full window and are not counted either.
 *
 * Honesty caveat, carried over from upstream verbatim in spirit: this is a
 * *same-key replay*. It is valid only against the same key, tokenizer and PRF
 * layout used at generation. A negative result establishes nothing, because
 * unwatermarked text, another provider's key and human text all sit at chance.
 * The default PRF layout is a clean-room instantiation of the scheme, not
 * bit-compatible with any particular engine's kernel.
 *
 * SHA-256 and HMAC-SHA256 are implemented here rather than taken from
 * crypto.subtle: subtle is async and needs a secure context, and a 1000-word
 * input costs roughly two thousand importKey + sign round trips. A synchronous
 * implementation keeps detect() callable like LayerA.inspect() and works from
 * file:// too. tests/test_gumbel_parity.py enforces the arithmetic.
 *
 * Works as a plain <script> (exposes window.Gumbel) and as a CommonJS module.
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------- SHA-256
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;

  /** SHA-256 of a byte array -> 32 bytes. */
  function sha256(bytes) {
    const bitLen = bytes.length * 8;
    const padded = new Uint8Array((((bytes.length + 9) >> 6) + 1) << 6);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    // Length is a 64-bit big-endian field; inputs here are far below 2^32 bits,
    // but the high word is written anyway so the padding is correct in general.
    const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 8, Math.floor(bitLen / 4294967296), false);
    dv.setUint32(padded.length - 4, bitLen >>> 0, false);

    const h = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    const w = new Uint32Array(64);
    for (let off = 0; off < padded.length; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
        const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i++) {
        const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        const ch = ((e & f) ^ (~e & g)) >>> 0;
        const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        const t2 = (S0 + maj) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }
    const out = new Uint8Array(32);
    const odv = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) odv.setUint32(i * 4, h[i], false);
    return out;
  }

  /** HMAC-SHA256(key, message) -> 32 bytes. */
  function hmacSha256(key, message) {
    const block = new Uint8Array(64);
    block.set(key.length > 64 ? sha256(key) : key);
    const inner = new Uint8Array(64 + message.length);
    const outer = new Uint8Array(64 + 32);
    for (let i = 0; i < 64; i++) { inner[i] = block[i] ^ 0x36; outer[i] = block[i] ^ 0x5c; }
    inner.set(message, 64);
    outer.set(sha256(inner), 64);
    return sha256(outer);
  }

  // ------------------------------------------------------------- primitives
  const DEFAULT_WINDOW = 4;
  const DEFAULT_THRESHOLD = 1e-6;
  const MAX_ID = (1n << 64n) - 1n;
  const SIMPLE_TOKEN_RE = /[A-Za-z0-9]+/g;
  const enc = new TextEncoder();

  /** Big-endian 8-byte packing of a token id, matching struct.Struct(">Q"). */
  function packId(id) {
    const out = new Uint8Array(8);
    let v = id;
    for (let i = 7; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
    return out;
  }
  const unpackU64 = (bytes) => {
    let v = 0n;
    for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(bytes[i]);
    return v;
  };

  /** Deterministic 64-bit id for a simple-tokenizer token string. */
  const tokenId = (tok) => unpackU64(sha256(enc.encode(tok)));

  /** Deterministic word/run tokenizer -> stable token ids.
   * Convenience path for quick checks. Exact replay against a real engine
   * needs that engine's own tokenizer: pass its ids to detectTokenIds. */
  function tokenizeSimple(text) {
    return (String(text).toLowerCase().match(SIMPLE_TOKEN_RE) || []).map(tokenId);
  }

  /** Key -> bytes: 0x<hex> decodes to raw bytes, anything else is UTF-8. */
  function normalizeKey(raw) {
    if (raw instanceof Uint8Array) return raw;
    const s = String(raw).trim();
    if (s.startsWith("0x") || s.startsWith("0X")) {
      const hex = s.slice(2);
      if (!hex || hex.length % 2 || /[^0-9a-fA-F]/.test(hex)) {
        throw new Error("invalid hex key (expected 0x followed by even-length hex)");
      }
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
      return out;
    }
    return enc.encode(s);
  }

  /** Context-window seed: HMAC-SHA256(key, packed window). */
  function seedFor(keyBytes, window) {
    const packed = new Uint8Array(window.length * 8);
    for (let i = 0; i < window.length; i++) packed.set(packId(window[i]), i * 8);
    return hmacSha256(keyBytes, packed);
  }

  /** Per-candidate uniform in (0, 1): HMAC-SHA256(seed, token id).
   * Python evaluates (n + 0.5) / 2**64 by converting the 64-bit integer to a
   * double first (round-half-even) and then adding 0.5, which is exactly what
   * Number(BigInt) + 0.5 does here. Keeping that order is what makes the
   * statistic reproduce bit for bit. */
  const uniform = (seed, id) => (Number(unpackU64(hmacSha256(seed, packId(id)))) + 0.5) / 2 ** 64;

  /** P(Gamma(n, 1) >= s) = e^-s * sum_{k=0}^{n-1} s^k / k!, exact for integer n.
   * Computed via logsumexp so large statistics never overflow or go NaN. */
  function poissonSurvival(s, n) {
    if (n <= 0 || s <= 0) return 1;
    const lns = Math.log(s);
    let logTerm = 0;
    let maxv = 0;
    for (let k = 1; k < n; k++) {
      logTerm += lns - Math.log(k);
      if (logTerm > maxv) maxv = logTerm;
    }
    logTerm = 0;
    let acc = Math.exp(-maxv);
    for (let k = 1; k < n; k++) {
      logTerm += lns - Math.log(k);
      acc += Math.exp(logTerm - maxv);
    }
    const p = Math.exp(-s + maxv + Math.log(acc));
    if (p < 0) return 0;
    if (p > 1) return 1;
    return p;
  }

  /* Python's round(x, 6) and JS toFixed(6) disagree only on exact decimal ties,
   * which a sum of logarithms does not produce in practice. The parity suite
   * compares this field with a relative tolerance for that reason. */
  const round6 = (x) => Number(x.toFixed(6));

  function coerceId(t) {
    if (typeof t === "bigint") { if (t < 0n || t > MAX_ID) throw new Error(`token id out of range: ${t}`); return t; }
    if (typeof t === "number") {
      if (!Number.isSafeInteger(t) || t < 0) throw new Error(`token id out of range: ${t}`);
      return BigInt(t);
    }
    if (typeof t === "string" && /^[0-9]+$/.test(t)) {
      const v = BigInt(t);
      if (v > MAX_ID) throw new Error(`token id out of range: ${t}`);
      return v;
    }
    throw new Error(`token id out of range: ${t}`);
  }

  /**
   * detectTokenIds(ids, key, {window, threshold, maskRepeated}) -> report
   *
   * maskRepeated mirrors the generator's repeated-window masking: a context
   * window counts only on its first occurrence, because the generator fell back
   * to ordinary randomness on recurrence and later occurrences carry no signal.
   * Positions with fewer than `window` preceding tokens are never counted.
   */
  function detectTokenIds(tokenIds, key, options) {
    const o = Object.assign({ window: DEFAULT_WINDOW, threshold: DEFAULT_THRESHOLD, maskRepeated: true }, options || {});
    const win = o.window;
    const threshold = o.threshold;
    if (!Number.isInteger(win) || win < 1) throw new Error("window must be >= 1");
    if (!(threshold > 0 && threshold < 1)) throw new Error("threshold must be in (0, 1)");
    const keyBytes = normalizeKey(key);
    const ids = Array.from(tokenIds, coerceId);

    const total = ids.length;
    let statistic = 0;
    let counted = 0;
    let skippedRepeated = 0;
    const seen = new Set();
    for (let t = win; t < total; t++) {
      const window = ids.slice(t - win, t);
      if (o.maskRepeated) {
        const seenKey = window.join(",");
        if (seen.has(seenKey)) { skippedRepeated++; continue; }
        seen.add(seenKey);
      }
      statistic += -Math.log1p(-uniform(seedFor(keyBytes, window), ids[t]));
      counted++;
    }

    const report = {
      detector: "gumbel",
      scheme: "exp",
      vendor: "self-hosted",
      available: true,
      window: win,
      threshold,
      tokens_total: total,
      skipped_no_context: Math.min(win, total),
      skipped_repeated: skippedRepeated,
      counted,
    };
    if (counted === 0) {
      report.is_watermarked = false;
      report.p_value = 1.0;
      report.score = 0.0;
      report.note = "no verifiable token positions (text too short for a full context window)";
      return report;
    }
    const p = poissonSurvival(statistic, counted);
    report.statistic = round6(statistic);
    report.p_value = p;
    report.score = round6(p > 0 ? -Math.log10(p) : 300.0);
    report.is_watermarked = p < threshold;
    report.note =
      "same-key replay of the keyed-Gumbel (Aaronson EXP) watermark; valid only " +
      "against the same key, tokenizer, and PRF layout used at generation";
    return report;
  }

  /** Run the replay test over plain text via the deterministic tokenizer. */
  const detectText = (text, key, options) => detectTokenIds(tokenizeSimple(text), key, options);

  const api = {
    DEFAULT_WINDOW, DEFAULT_THRESHOLD,
    detectText, detectTokenIds, tokenizeSimple, tokenId, normalizeKey,
    sha256, hmacSha256, poissonSurvival,
  };
  root.Gumbel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
