/* Detector registry for the Watermark Inspector.
 *
 * Every detector — browser-side Unicode/metadata parsers, the in-browser
 * stylometry heuristic, the optional local statistical sidecar, an upstream
 * server — speaks one contract so the UI, the before/after comparison and the
 * JSON export never special-case a layer:
 *
 *   detector  { id, layer, local, requires_key, requires_model, heuristic,
 *               applies(input) -> bool, run(input, ctx, cache) -> Promise<result> }
 *   result    { detector, layer, status, confidence, score, threshold,
 *               evidence:[{label, detail, offsets?}], note, noteKey, noteParams,
 *               requires_key, requires_model, local, heuristic, meta }
 *
 * `status` is one of STATUSES. "detected" is reserved for detectors that
 * actually recognise a mark; a heuristic (stylometry) may at most say
 * "uncertain". "unavailable" means "cannot run in this environment" (e.g. the
 * statistical sidecar from the hosted HTTPS page), "not_tested" means the
 * detector exists but was not exercised, "not_applicable" means the input type
 * does not fit (image detectors on text).
 *
 * Inputs: { kind:"text", text } or { kind:"file", name, u8 }.
 * Detectors must not mutate the input; cleaning is a separate step so the
 * Inspector can honestly show whether cleaning changed each detector's answer.
 */
(function (root) {
  "use strict";

  const STATUSES = ["clean", "detected", "uncertain", "unavailable", "not_tested", "not_applicable", "error"];
  const LAYERS = ["character", "metadata", "statistical"];

  const registry = [];

  function register(def) {
    if (!def || typeof def.id !== "string" || !LAYERS.includes(def.layer)) throw new Error("bad detector definition");
    registry.push(Object.assign({ local: true, requires_key: false, requires_model: false, heuristic: false }, def));
    return def;
  }
  const list = (layer) => registry.filter((d) => !layer || d.layer === layer);
  const byId = (id) => registry.find((d) => d.id === id) || null;

  function result(def, patch) {
    const r = {
      detector: def.id, layer: def.layer, status: "not_tested",
      confidence: null, score: null, threshold: null,
      evidence: [], note: null, noteKey: null, noteParams: null,
      requires_key: !!def.requires_key, requires_model: !!def.requires_model,
      local: !!def.local, heuristic: !!def.heuristic, meta: {},
    };
    Object.assign(r, patch || {});
    if (!STATUSES.includes(r.status)) r.status = "error";
    return r;
  }

  /* Run every registered detector in layer order. `onEach(result, index, total)`
   * lets the UI paint rows as they arrive (the sidecar is slow). A throwing
   * detector yields an "error" row instead of aborting the run. */
  async function runAll(input, ctx, onEach) {
    const cache = {};
    const defs = LAYERS.flatMap((l) => list(l));
    const out = [];
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      let r;
      try {
        if (!d.applies(input)) r = result(d, { status: "not_applicable" });
        else r = await d.run(input, ctx || {}, cache);
      } catch (e) {
        if (ctx && ctx.signal && ctx.signal.aborted) throw e;   // a cancelled run is not a detector error
        r = result(d, { status: "error", note: String((e && e.message) || e) });
      }
      out.push(r);
      if (onEach) { try { onEach(r, i, defs.length); } catch (_) { /* UI errors must not stop the run */ } }
    }
    return out;
  }

  // ------------------------------------------------------------ character layer (Layer A)
  const isText = (input) => !!input && input.kind === "text" && typeof input.text === "string";
  const layerAReport = (input, ctx, cache) => {
    if (!cache.layerA) cache.layerA = root.LayerA.inspect(input.text, (ctx && ctx.layerAOptions) || {});
    return cache.layerA;
  };
  const hitsToEvidence = (hits) => hits.map((h) => ({
    label: h.codepoint, detail: `${h.label} ×${h.count} (${h.kind}, ${h.confidence})`, offsets: h.sample_offsets || [],
  }));
  function characterDetector(id, kinds, opts) {
    const informational = (opts && opts.informational) || [];
    register({
      id, layer: "character",
      applies: isText,
      run(input, ctx, cache) {
        const rep = layerAReport(input, ctx, cache);
        const hits = rep.hits.filter((h) => kinds.includes(h.kind));
        const total = hits.reduce((n, h) => n + h.count, 0);
        const strong = hits.filter((h) => !informational.includes(h.kind));
        const def = byId(id);
        if (!hits.length) return result(def, { status: "clean", score: 0, meta: { length: rep.length } });
        return result(def, {
          status: strong.length ? "detected" : "uncertain",
          score: total, confidence: strong.length ? 1 : null,
          evidence: hitsToEvidence(hits),
          noteKey: strong.length ? null : "inspect.noteInformational",
          meta: { length: rep.length, kinds: [...new Set(hits.map((h) => h.kind))] },
        });
      },
    });
  }
  characterDetector("unicode-invisible", ["strip", "zwj_family", "variation_selector", "tag_chars", "private_use", "other_cf", "reserved_ignorable", "noncharacter"]);
  characterDetector("bidi-controls", ["bidi"]);
  characterDetector("homoglyph", ["confusable", "space"], { informational: ["space"] });

  // ------------------------------------------------------------ metadata layer (image containers)
  const isFile = (input) => !!input && input.kind === "file" && input.u8 instanceof Uint8Array;
  const imageReport = (input, cache) => {
    if (!("image" in cache)) {
      const fmt = root.ImageMeta.detectFormat(input.u8);
      cache.image = fmt ? root.ImageMeta.inspect(input.u8) : null;
    }
    return cache.image;
  };
  /* ImageMeta.inspect() reports prose findings (kept upstream-shaped for the
   * parity suite), so the buckets are regexes over those strings. Anything that
   * matches nothing lands in "other-metadata" rather than disappearing. */
  const META_BUCKETS = {
    "c2pa": /c2pa|jumb|content ?credentials|contentauth|cai:|manifest/i,
    "xmp": /\bxmp\b|xml metadata|xpacket|adobe:ns:meta/i,
    "exif": /\bexif\b|\bAPP1\b(?![^]*xmp)|TIFF (tag|IFD)|\bIFD\b/i,
    "ai-generator-marker": /AI generator|Software=|Creator=|parameters=|digitalSourceType|trainedAlgorithmicMedia|dall-e|midjourney|stable diffusion|chatgpt|gemini|firefly|sora|flux|sdxl/i,
  };
  const META_IDS = Object.keys(META_BUCKETS).concat("other-metadata");
  function bucketFindings(findings) {
    const buckets = Object.fromEntries(META_IDS.map((k) => [k, []]));
    for (const f of findings) {
      let placed = false;
      for (const [id, re] of Object.entries(META_BUCKETS)) if (re.test(f)) { buckets[id].push(f); placed = true; }
      if (!placed) buckets["other-metadata"].push(f);
    }
    return buckets;
  }
  for (const id of META_IDS) {
    register({
      id, layer: "metadata",
      applies: isFile,
      run(input, ctx, cache) {
        const def = byId(id);
        const rep = imageReport(input, cache);
        if (!rep) return result(def, { status: "not_applicable", noteKey: "inspect.noteUnsupportedFile" });
        if (!cache.buckets) cache.buckets = bucketFindings(rep.findings || []);
        const lines = cache.buckets[id];
        const evidence = lines.map((l) => ({ label: rep.format, detail: l }));
        const meta = { format: rep.format, has_c2pa: !!rep.has_c2pa, has_ai_metadata: !!rep.has_ai_metadata };
        if (id === "c2pa") {
          if (rep.has_c2pa) return result(def, { status: "detected", confidence: 1, score: lines.length, evidence, meta });
          return result(def, { status: lines.length ? "uncertain" : "clean", score: lines.length, evidence, meta });
        }
        if (id === "ai-generator-marker") {
          if (lines.length) return result(def, { status: rep.has_ai_metadata ? "detected" : "uncertain", confidence: rep.has_ai_metadata ? 1 : null, score: lines.length, evidence, meta });
          return result(def, { status: "clean", score: 0, meta });
        }
        // exif / xmp / other: presence is a finding, not a watermark verdict.
        if (!lines.length) return result(def, { status: "clean", score: 0, meta });
        const structural = lines.every((l) => /truncated|bad segment|mismatch|trailing|no .*metadata|unrecognized|header-only/i.test(l));
        return result(def, {
          status: structural ? "clean" : "uncertain", score: lines.length, evidence, meta,
          noteKey: structural ? "inspect.noteStructural" : "inspect.noteMetadataPresent",
        });
      },
    });
  }

  // ------------------------------------------------------------ statistical layer
  // Stylometry: an in-browser *heuristic* (upstream score_stylometry.py). It is
  // deliberately capped at "uncertain" — cadence and phrase density are not a
  // watermark, and the UI says so on the row.
  register({
    id: "stylometry", layer: "statistical", heuristic: true,
    applies: isText,
    run(input) {
      const def = byId("stylometry");
      if (!root.Stylometry || typeof root.Stylometry.score !== "function") return result(def, { status: "unavailable", noteKey: "inspect.noteNoStylometry" });
      const rep = root.Stylometry.score(input.text);
      const evidence = [];
      if (rep.burstiness_cv != null) evidence.push({ label: "burstiness_cv", detail: String(rep.burstiness_cv) });
      if (rep.lexical_diversity != null) evidence.push({ label: "lexical_diversity", detail: String(rep.lexical_diversity) });
      evidence.push({ label: "ai_ngram_density", detail: String(rep.ai_ngram_density) });
      for (const m of rep.matched_markers || []) evidence.push({ label: "marker", detail: `${m.phrase} ×${m.count} (w=${m.weight})` });
      for (const f of rep.findings || []) evidence.push({ label: "finding", detail: f });
      let status = "clean";
      if (rep.status === "insufficient_length") status = "not_tested";
      else if (rep.confidence_level === "HIGH" || rep.confidence_level === "MEDIUM") status = "uncertain";
      return result(def, {
        status, score: rep.score, threshold: root.Stylometry.DEFAULT_THRESHOLD != null ? root.Stylometry.DEFAULT_THRESHOLD : null,
        evidence, noteKey: "inspect.noteHeuristic",
        meta: { word_count: rep.word_count, sentence_count: rep.sentence_count, confidence_level: rep.confidence_level, status: rep.status },
      });
    },
  });

  // Local statistical sidecar (sidecar/unmark_stat.py behind serve_local.py's
  // /stat proxy). One POST scores every sidecar detector; the rows share it.
  const SIDECAR_IDS = ["kgw", "synthid-text"];
  async function sidecarResults(input, ctx, cache) {
    if (!cache.sidecar) {
      cache.sidecar = (async () => {
        const want = SIDECAR_IDS.filter((id) => ctx.stat.detectors.includes(id));
        const res = await root.WmApi.statDetect(input.text, { detectors: want, keyProfile: ctx.stat.keyProfile || "a" }, ctx.signal || null);
        const map = {};
        for (const r of (res && res.results) || []) if (r && r.detector) map[r.detector] = r;
        return map;
      })();
    }
    return cache.sidecar;
  }
  for (const id of SIDECAR_IDS) {
    register({
      id, layer: "statistical", requires_key: true, requires_model: true,
      applies: isText,
      async run(input, ctx, cache) {
        const def = byId(id);
        const stat = ctx.stat || {};
        if (!stat.enabled) return result(def, { status: "unavailable", noteKey: "inspect.noteNoSidecar" });
        if (!(stat.detectors || []).includes(id)) return result(def, { status: "unavailable", noteKey: "inspect.noteDetectorOff" });
        const all = await sidecarResults(input, ctx, cache);
        const r = all[id];
        if (!r) return result(def, { status: "error", note: "sidecar returned no result for " + id });
        const out = result(def, {
          status: r.status, confidence: r.confidence == null ? null : r.confidence, score: r.score == null ? null : r.score,
          threshold: r.threshold == null ? null : r.threshold,
          evidence: Array.isArray(r.evidence) ? r.evidence.map((e) => ({ label: String(e.label), detail: String(e.detail) })) : [],
          note: r.note || null, meta: Object.assign({}, r.meta || {}, { key_profile: stat.keyProfile || "a" }),
        });
        return out;
      },
    });
  }

  // Upstream watermarks-remover server: POST /detect when the configured
  // service advertises text detectors (MarkLLM harness, vendor seams).
  register({
    id: "upstream-detect", layer: "statistical", local: false, requires_key: true, requires_model: true,
    applies: isText,
    async run(input, ctx) {
      const def = byId("upstream-detect");
      const srv = ctx.server || {};
      const caps = (srv.caps && srv.caps.text_detectors) || null;
      const advertised = Array.isArray(caps) ? caps : caps && typeof caps === "object" ? Object.keys(caps) : [];
      if (!srv.reachable || typeof root.WmApi.detect !== "function") return result(def, { status: "unavailable", noteKey: "inspect.noteNoServer" });
      if (!advertised.length) return result(def, { status: "unavailable", noteKey: "inspect.noteNoServerDetectors" });
      const res = await root.WmApi.detect(new TextEncoder().encode(input.text), "inspector.txt");
      const dets = (res && res.detections) || [];
      const evidence = [];
      let detected = false, anyAvailable = false, best = null;
      for (const d of dets) {
        if (!d || typeof d !== "object") continue;
        const name = d.detector || d.scheme || "?";
        if (d.available === false) { evidence.push({ label: name, detail: "unavailable: " + (d.error || "") }); continue; }
        anyAvailable = true;
        if (d.is_watermarked) detected = true;
        if (typeof d.score === "number" && (best == null || d.score > best.score)) best = { score: d.score, threshold: typeof d.threshold === "number" ? d.threshold : null };
        evidence.push({ label: name, detail: `is_watermarked=${!!d.is_watermarked} score=${d.score == null ? "-" : d.score} threshold=${d.threshold == null ? "-" : d.threshold}` + (d.note ? ` — ${d.note}` : "") });
      }
      if (!anyAvailable) return result(def, { status: "unavailable", evidence, noteKey: "inspect.noteServerDetectorsDown" });
      return result(def, { status: detected ? "detected" : "clean", score: best ? best.score : null, threshold: best ? best.threshold : null, evidence, meta: { detectors: advertised } });
    },
  });

  // TextSeal (facebookresearch/textseal, Apache-2.0): key + model bound like the
  // others. Registered so the table is honest about what has *not* been run.
  register({
    id: "textseal", layer: "statistical", requires_key: true, requires_model: true,
    applies: isText,
    run() { return result(byId("textseal"), { status: "not_tested", noteKey: "inspect.noteTextSeal" }); },
  });

  /* Overall verdict helpers — used by the UI sentence and the JSON export. */
  function summarize(results) {
    const by = (layer) => results.filter((r) => r.layer === layer);
    const has = (rs, s) => rs.some((r) => r.status === s);
    const ch = by("character"), md = by("metadata"), st = by("statistical");
    const real = st.filter((r) => !r.heuristic);
    return {
      character: has(ch, "detected") ? "detected" : has(ch, "uncertain") ? "uncertain" : ch.every((r) => r.status === "not_applicable") ? "not_applicable" : "clean",
      metadata: has(md, "detected") ? "detected" : has(md, "uncertain") ? "uncertain" : md.every((r) => r.status === "not_applicable") ? "not_applicable" : "clean",
      statistical: has(real, "detected") ? "detected" : has(real, "uncertain") ? "uncertain"
        : real.some((r) => r.status === "clean") ? "clean"
        : real.every((r) => r.status === "not_applicable") ? "not_applicable" : "unavailable",
      heuristic: st.filter((r) => r.heuristic).map((r) => r.status)[0] || null,
    };
  }

  /* Did cleaning change a detector's answer? `sameStatus` is the verdict
   * (status) being unchanged; `delta` is the numeric score movement when both
   * sides have one. Tokenisation shifts when invisible characters are removed,
   * so a statistical score may move a little while the verdict stands — the UI
   * reports both rather than calling a 0.967 → 0.999 posterior "changed". */
  function compare(before, after) {
    const map = Object.fromEntries(after.map((r) => [r.detector, r]));
    return before.map((b) => {
      const a = map[b.detector] || null;
      const num = (x) => (typeof x === "number" ? x : null);
      const sameStatus = !!a && a.status === b.status;
      const delta = a && num(a.score) != null && num(b.score) != null ? a.score - b.score : null;
      const same = sameStatus && (delta == null || Math.abs(delta) < 1e-9);
      return { detector: b.detector, layer: b.layer, before: b, after: a, same, sameStatus, delta };
    });
  }

  const api = { STATUSES, LAYERS, register, list, byId, result, runAll, summarize, compare };
  root.Detectors = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
