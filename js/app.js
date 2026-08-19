/* UI wiring. No inline HTML from user data — every user-controlled string goes through textContent. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const t = (k, p) => I18n.t(k, p);

  const BROWSER_MAX_BYTES = 64 << 20;   // 64 MiB — keeps memory sane in a tab
  const SERVER_MAX_BYTES = 256 << 20;   // upstream WATERMARKS_MAX_INPUT_BYTES default
  const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "avif", "heic", "heif", "bmp", "gif", "tif", "tiff"]);
  // Keyed by the format ImageMeta detected, not by extension: the detector is
  // the authority, and a chained ternary silently mislabelled AVIF/HEIC as WebP.
  const IMAGE_MIME = {
    png: "image/png", jpeg: "image/jpeg", webp: "image/webp", avif: "image/avif",
    heic: "image/heic", bmp: "image/bmp", gif: "image/gif", tiff: "image/tiff",
  };
  const TEXT_EXT = new Set(["txt", "md", "markdown", "html", "htm", "svg"]);
  const SERVER_ONLY_EXT = new Set(["pdf", "docx", "odt", "epub"]);

  const fmtBytes = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const debounce = (fn, ms) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; };

  // ---------------------------------------------------------------- toast
  let toastTimer = null;
  function toast(msg, icon = "✅") {
    $("toast-msg").textContent = msg; $("toast-icon").textContent = icon;
    $("toast").classList.add("show"); clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2500);
  }

  // ---------------------------------------------------------------- server / engine state
  const server = { reachable: false, version: "", caps: null, checking: false };
  const enginePref = () => (document.querySelector('input[name="engine"]:checked') || {}).value || "auto";
  const useServer = () => (enginePref() === "server") || (enginePref() === "auto" && server.reachable);

  function renderEngineState() {
    const badge = $("engine-status"), text = $("engine-text"), desc = $("engine-desc"), drop = $("dropzone-desc");
    const cfg = WmApi.config;
    if (useServer() && server.reachable) {
      badge.className = "engine-status-badge server-mode";
      text.textContent = t("engineServer", { url: cfg.baseUrl, version: server.version || "?" });
      desc.textContent = t("engineDescServer"); drop.textContent = t("dropDescServer");
    } else {
      badge.className = "engine-status-badge";
      text.textContent = t("engineBrowser");
      desc.textContent = cfg.baseUrl && enginePref() !== "browser" ? t("engineDescServerDown") : t("engineDescBrowser");
      drop.textContent = t("dropDescBrowser");
    }
  }

  async function probeServer(showStatus) {
    const status = $("srv-status");
    if (!WmApi.config.baseUrl || enginePref() === "browser") { server.reachable = false; renderEngineState(); if (showStatus) status.textContent = ""; return; }
    if (server.checking) return;
    server.checking = true;
    if (showStatus) status.textContent = t("srvTesting");
    try {
      const h = await WmApi.health();
      server.reachable = true; server.version = h.version || "";
      try { server.caps = await WmApi.capabilities(); } catch (_) { server.caps = null; }
      if (showStatus) {
        const tools = server.caps && server.caps.tools ? Object.entries(server.caps.tools).filter(([, v]) => v).map(([k]) => k) : [];
        status.textContent = t("srvOk", { version: server.version || "?", caps: tools.length ? ` · ${tools.join(", ")}` : "" });
      }
    } catch (e) {
      server.reachable = false; server.version = ""; server.caps = null;
      if (showStatus) status.textContent = t("srvFail", { error: e.message });
    } finally { server.checking = false; renderEngineState(); }
  }

  function initSettings() {
    const cfg = WmApi.load();
    $("srv-url").value = cfg.baseUrl; $("srv-key").value = cfg.apiKey; $("srv-remember").checked = cfg.remember;
    if (!cfg.baseUrl && /^https?:$/.test(location.protocol) && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
      // Served by serve_local.py? Its /api proxy is same-origin — use it as the unsaved default.
      WmApi.config.baseUrl = "/api"; $("srv-url").placeholder = location.origin + "/api";
    }
    const commit = () => { WmApi.save({ baseUrl: $("srv-url").value, apiKey: $("srv-key").value, remember: $("srv-remember").checked }); $("srv-url").value = WmApi.config.baseUrl; };
    $("srv-url").addEventListener("change", () => { commit(); probeServer(true); });
    $("srv-key").addEventListener("change", () => { commit(); probeServer(true); });
    $("srv-remember").addEventListener("change", commit);
    $("btn-srv-test").addEventListener("click", () => { commit(); probeServer(true); });
    $("btn-srv-clear").addEventListener("click", () => {
      $("srv-url").value = ""; $("srv-key").value = ""; $("srv-remember").checked = false; commit(); $("srv-status").textContent = ""; probeServer(false);
    });
    document.querySelectorAll('input[name="engine"]').forEach((r) => r.addEventListener("change", () => probeServer(true)));
    $("btn-settings").addEventListener("click", () => {
      const p = $("settings-panel"); const open = p.hasAttribute("hidden");
      if (open) p.removeAttribute("hidden"); else p.setAttribute("hidden", "");
      $("btn-settings").setAttribute("aria-expanded", String(open));
      if (open) $("srv-url").focus();
    });
    if (cfg.baseUrl) probeServer(false);
  }

  // ---------------------------------------------------------------- text tab
  const inputEl = $("input-text"), outputEl = $("output-text");
  function textOptions() {
    return { normalizeSpaces: $("opt-spaces").checked, nfkc: $("opt-nfkc").checked, aggressiveHomoglyphs: $("opt-latin").checked, stripEmojiGlue: $("opt-glue").checked };
  }
  function runText() {
    const text = inputEl.value;
    const box = $("text-report-box"), tags = $("text-report-tags");
    if (!text) { outputEl.textContent = ""; $("char-count-in").textContent = t("chars", { n: 0 }); $("char-count-out").textContent = t("chars", { n: 0 }); box.classList.remove("show"); clearRewriteOutput(); return; }
    const { cleaned, stats } = LayerA.clean(text, textOptions());
    outputEl.textContent = cleaned;
    $("char-count-in").textContent = t("chars", { n: stats.input_length });
    $("char-count-out").textContent = t("chars", { n: stats.output_length });
    tags.replaceChildren();
    let any = false;
    for (const [label, n] of Object.entries(stats.removed)) { any = true; tags.appendChild(el("span", "tag-badge", "⚠️ " + t("removedTag", { n, label }))); }
    for (const [label, n] of Object.entries(stats.replaced)) {
      any = true;
      tags.appendChild(el("span", "tag-badge", label === "NFKC_normalize" ? "🔤 " + t("nfkcTag", { n }) : "🔄 " + t("replacedTag", { n, label })));
    }
    if (!any) tags.appendChild(el("span", "tag-badge clean", t("cleanText")));
    box.classList.add("show");
    clearRewriteOutput();          // stale rewrites must not outlive their input
  }
  const runTextDebounced = debounce(runText, 120);
  inputEl.addEventListener("input", runTextDebounced);
  ["opt-spaces", "opt-nfkc", "opt-latin", "opt-glue"].forEach((id) => $(id).addEventListener("change", runText));
  $("btn-clear-text").addEventListener("click", () => { inputEl.value = ""; runText(); inputEl.focus(); });
  $("btn-sample-text").addEventListener("click", () => { inputEl.value = t("sample"); runText(); });
  $("btn-copy-text").addEventListener("click", async () => {
    const text = outputEl.textContent; if (!text) return;
    try { await navigator.clipboard.writeText(text); toast(t("copied")); }
    catch (_) { toast(t("copyFailed"), "⚠️"); }
  });

  // ---------------------------------------------------------------- AI rewrite (local endpoint only)
  /* Opt-in and local-only: the panel exists only when serve_local.py reports a
   * configured OpenAI-compatible endpoint. The request goes same-origin to
   * /llm, so no key ever lives in the browser and the hosted HTTPS build — which
   * cannot reach a plain-HTTP local endpoint anyway — simply never shows it. */
  const REWRITE_KEY = "unmark-web.rewrite";
  const rewrite = { enabled: false, busy: false, ctrl: null, customPrompt: null };

  function saveRewritePrefs() {
    try {
      const data = { model: $("rewrite-model").value };
      if (rewrite.customPrompt) data.prompt = rewrite.customPrompt;   // defaults follow the UI language instead
      localStorage.setItem(REWRITE_KEY, JSON.stringify(data));
    } catch (_) { /* storage unavailable (file://, private mode) */ }
  }

  function applyRewritePromptDefault() {
    if (rewrite.enabled && rewrite.customPrompt == null) $("rewrite-prompt").value = t("rewritePromptDefault");
  }

  function clearRewriteOutput() {
    if (rewrite.enabled && !rewrite.busy) $("rewrite-output").textContent = "";
  }

  function setRewriteBusy(on) {
    rewrite.busy = on;
    $("btn-rewrite").disabled = on;
    $("btn-rewrite-cancel").hidden = !on;
  }

  async function runRewrite() {
    if (rewrite.busy) return;
    const text = outputEl.textContent;
    if (!text.trim()) { toast(t("rewriteEmpty"), "⚠️"); return; }
    const out = $("rewrite-output");
    out.textContent = t("rewriteBusy");
    rewrite.ctrl = new AbortController();
    setRewriteBusy(true);
    try {
      const res = await WmApi.llmRewrite($("rewrite-prompt").value, text, $("rewrite-model").value.trim(), rewrite.ctrl.signal);
      // The user may have kept typing; a reply that no longer matches what is on
      // screen is dropped rather than shown against the wrong source text.
      if (outputEl.textContent !== text) { out.textContent = ""; return; }
      const msg = res && res.choices && res.choices[0] && res.choices[0].message;
      const content = msg && typeof msg.content === "string" ? msg.content.trim() : "";
      if (!content) throw new Error("empty response from the endpoint");
      out.textContent = content;                       // textContent: model output is never markup here
    } catch (e) {
      const reason = String((e && e.message) || e);
      out.textContent = "";
      toast(reason === "cancelled" ? t("rewriteCancelled") : t("rewriteFailed", { msg: reason }), "⚠️");
    } finally {
      setRewriteBusy(false);
      rewrite.ctrl = null;
    }
  }

  async function initRewrite() {
    let cfg = null;
    try { cfg = await WmApi.llmConfig(); } catch (_) { /* not served locally, or no proxy */ }
    rewrite.enabled = !!(cfg && cfg.enabled);
    $("rewrite-box").hidden = !rewrite.enabled;
    $("rewrite-hint").hidden = rewrite.enabled;
    if (!rewrite.enabled) return;

    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(REWRITE_KEY) || "{}") || {}; } catch (_) { /* ignore */ }
    rewrite.customPrompt = typeof saved.prompt === "string" && saved.prompt.trim() ? saved.prompt : null;
    $("rewrite-prompt").value = rewrite.customPrompt || t("rewritePromptDefault");
    $("rewrite-model").value = saved.model || cfg.model || "";

    $("rewrite-prompt").addEventListener("change", () => {
      const v = $("rewrite-prompt").value;
      rewrite.customPrompt = v.trim() && v !== t("rewritePromptDefault") ? v : null;
      if (rewrite.customPrompt == null) $("rewrite-prompt").value = t("rewritePromptDefault");
      saveRewritePrefs();
    });
    $("rewrite-model").addEventListener("change", saveRewritePrefs);
    $("btn-rewrite").addEventListener("click", runRewrite);
    $("btn-rewrite-cancel").addEventListener("click", () => { if (rewrite.ctrl) rewrite.ctrl.abort(); });
    $("btn-copy-rewrite").addEventListener("click", async () => {
      const text = $("rewrite-output").textContent; if (!text) return;
      try { await navigator.clipboard.writeText(text); toast(t("copied")); }
      catch (_) { toast(t("copyFailed"), "⚠️"); }
    });

    // Best-effort: many OpenAI-compatible servers expose /v1/models, some don't.
    try {
      const list = await WmApi.llmModels();
      const ids = ((list && list.data) || []).map((m) => m && m.id).filter((id) => typeof id === "string");
      const dl = $("rewrite-model-list");
      dl.replaceChildren();
      for (const id of ids.slice(0, 200)) {
        const opt = document.createElement("option");
        opt.value = id;
        dl.appendChild(opt);
      }
      if (!$("rewrite-model").value && ids.length === 1) $("rewrite-model").value = ids[0];
    } catch (_) { /* no model listing — the free-text field still works */ }
  }

  // ---------------------------------------------------------------- Watermark Inspector
  /* Detectors only. The Inspector never rewrites the input by itself; "Clean &
   * re-inspect" runs Layer A once and shows every detector before/after so the
   * user can see which layer the cleaner actually touched. Statistical rows need
   * the local sidecar (serve_local.py --stat-upstream …) and report
   * "unavailable" everywhere else, hosted page included. */
  const INSPECT_KEY = "unmark-web.inspect";
  const insp = {
    input: null,            // {kind:"text",text} | {kind:"file",name,u8}
    results: null,          // last run
    compare: null,          // [{detector, before, after, same}] after "Clean & re-inspect"
    cleanedText: null,
    busy: false, ctrl: null,
    stat: { enabled: false, detectors: [], generate: false, keyProfile: "a", model: "" },
    demoCtrl: null,
  };
  const inspText = $("inspect-text");

  function inspectInput() {
    if (insp.input && insp.input.kind === "file") return insp.input;
    return { kind: "text", text: inspText.value };
  }
  function inspectCtx(signal) {
    const o = textOptions();
    return {
      layerAOptions: { aggressive: o.aggressiveHomoglyphs, stripEmojiGlue: o.stripEmojiGlue },
      stat: Object.assign({}, insp.stat, { keyProfile: $("inspect-key").value || "a" }),
      server, signal,
    };
  }
  function setInspectBusy(on) {
    insp.busy = on;
    $("btn-inspect-run").disabled = on; $("btn-inspect-clean").disabled = on; $("btn-inspect-json").disabled = on;
    $("btn-inspect-cancel").hidden = !on;
  }
  function statusBadge(status) {
    const b = el("span", "tag-badge status-" + status, t("status." + status));
    return b;
  }
  function flagBadges(r) {
    const wrap = el("span", "inspect-flags");
    if (r.heuristic) wrap.appendChild(el("span", "flag flag-heuristic", t("inspect.flagHeuristic")));
    if (r.requires_key) wrap.appendChild(el("span", "flag", t("inspect.flagKey")));
    if (r.requires_model) wrap.appendChild(el("span", "flag", t("inspect.flagModel")));
    wrap.appendChild(el("span", "flag", t(r.local ? "inspect.flagLocal" : "inspect.flagRemote")));
    return wrap;
  }
  function fmtScore(r) {
    if (!r) return "—";
    const parts = [];
    if (typeof r.score === "number") parts.push((Number.isInteger(r.score) ? String(r.score) : r.score.toFixed(3)) + (typeof r.threshold === "number" ? ` / ${r.threshold.toFixed(3)}` : ""));
    if (typeof r.confidence === "number" && !Number.isInteger(r.score)) parts.push(`p=${r.confidence.toFixed(3)}`);
    return parts.length ? parts.join(" · ") : "—";
  }
  function noteText(r) {
    if (!r) return "";
    if (r.noteKey) return t(r.noteKey, r.noteParams || undefined);
    return r.note || "";
  }
  function evidenceCell(r) {
    const td = el("td", "inspect-evidence");
    if (!r || !r.evidence || !r.evidence.length) { const n = noteText(r); if (n) td.appendChild(el("div", "inspect-note", n)); return td; }
    const d = el("details");
    d.appendChild(el("summary", null, t("inspect.evidenceN", { n: r.evidence.length })));
    const ul = el("ul");
    for (const e of r.evidence.slice(0, 60)) {
      const li = el("li");
      li.appendChild(el("code", null, e.label)); li.appendChild(document.createTextNode(" " + e.detail));
      if (e.offsets && e.offsets.length) li.appendChild(el("span", "inspect-offsets", " @" + e.offsets.slice(0, 8).join(",")));
      ul.appendChild(li);
    }
    if (r.evidence.length > 60) ul.appendChild(el("li", "inspect-note", "…"));
    d.appendChild(ul); td.appendChild(d);
    const n = noteText(r); if (n) td.appendChild(el("div", "inspect-note", n));
    return td;
  }

  function renderInspect() {
    $("inspect-count").textContent = t("chars", { n: inspText.value.length });   // re-localised on language change too
    const box = $("inspect-results"); box.replaceChildren();
    const results = insp.results;
    if (!results) { $("inspect-overall").classList.remove("show"); return; }
    const cmp = insp.compare ? Object.fromEntries(insp.compare.map((c) => [c.detector, c])) : null;
    for (const layer of Detectors.LAYERS) {
      const rows = results.filter((r) => r.layer === layer && r.status !== "not_applicable");
      if (!rows.length) continue;   // a whole layer that does not apply (image rows on text) is not worth a table
      const sec = el("section", "inspect-layer");
      sec.appendChild(el("h3", null, t("inspect.layer." + layer)));
      const table = el("table", "inspect-table");
      const thead = el("thead"); const hr = el("tr");
      const heads = cmp ? ["detector", "before", "after", "delta", "evidence"] : ["detector", "status", "score", "evidence"];
      for (const h of heads) hr.appendChild(el("th", null, t("inspect.col." + h)));
      thead.appendChild(hr); table.appendChild(thead);
      const tbody = el("tbody");
      for (const r of rows) {
        const tr = el("tr", "row-" + r.status);
        const name = el("td", "inspect-name"); name.appendChild(el("div", null, t("det." + r.detector))); name.appendChild(flagBadges(r)); tr.appendChild(name);
        if (cmp) {
          const c = cmp[r.detector]; const a = c && c.after;
          const tdB = el("td"); tdB.appendChild(statusBadge(r.status)); tdB.appendChild(el("div", "inspect-score", fmtScore(r))); tr.appendChild(tdB);
          const tdA = el("td"); if (a) { tdA.appendChild(statusBadge(a.status)); tdA.appendChild(el("div", "inspect-score", fmtScore(a))); } else tdA.textContent = "—"; tr.appendChild(tdA);
          let deltaText, deltaCls;
          if (!c || !c.sameStatus) { deltaText = t("inspect.changedTo", { from: t("status." + r.status), to: t("status." + (a ? a.status : "error")) }); deltaCls = "changed"; }
          else if (c.same) { deltaText = t("inspect.unchanged"); deltaCls = "same"; }
          else { deltaText = t("inspect.sameVerdict", { delta: (c.delta > 0 ? "+" : "") + (Number.isInteger(c.delta) ? String(c.delta) : c.delta.toFixed(3)) }); deltaCls = "same"; }
          tr.appendChild(el("td", "inspect-delta " + deltaCls, deltaText));
          tr.appendChild(evidenceCell(r));   // what was found *before* cleaning is the evidence worth reading
        } else {
          const tdS = el("td"); tdS.appendChild(statusBadge(r.status)); tr.appendChild(tdS);
          tr.appendChild(el("td", "inspect-score", fmtScore(r)));
          tr.appendChild(evidenceCell(r));
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      const wrap = el("div", "inspect-table-wrap"); wrap.appendChild(table); sec.appendChild(wrap);
      box.appendChild(sec);
    }
    renderOverall();
  }

  function renderOverall() {
    const lines = $("inspect-overall-lines"); lines.replaceChildren();
    const res = insp.results;
    if (!res) { $("inspect-overall").classList.remove("show"); return; }
    const s = Detectors.summarize(res);   // the state of the input as given; the cleaning lines follow
    const add = (k, p) => lines.appendChild(el("p", null, t(k, p)));
    if (s.character !== "not_applicable") add("overall.character." + s.character);
    if (s.metadata !== "not_applicable") add("overall.metadata." + s.metadata);
    if (s.statistical !== "not_applicable") add("overall.statistical." + s.statistical);
    if (s.heuristic && s.heuristic !== "not_applicable") add("overall.heuristic." + s.heuristic);
    if (insp.compare) {
      const stat = insp.compare.filter((c) => c.layer === "statistical" && c.before && !c.before.heuristic && ["detected", "uncertain", "clean"].includes(c.before.status));
      if (stat.length && stat.every((c) => c.same)) add("overall.cleanNoEffect");
      else if (stat.length && stat.every((c) => c.sameStatus)) add("overall.cleanNoEffectDelta");
      else if (stat.length) add("overall.cleanChanged");
      const ch = insp.compare.filter((c) => c.layer === "character");
      if (ch.length) add(ch.every((c) => c.after && c.after.status === "clean") ? "overall.characterCleaned" : "overall.characterResidual");
    }
    $("inspect-overall").classList.add("show");
  }

  async function runInspect(mode) {
    if (insp.busy) return;
    const input = inspectInput();
    if (input.kind === "text" && !input.text.trim()) { toast(t("inspectEmpty"), "⚠️"); return; }
    insp.ctrl = new AbortController();
    setInspectBusy(true);
    $("inspect-status").textContent = t("inspectRunning");
    insp.compare = null; insp.cleanedText = null;
    try {
      const ctx = inspectCtx(insp.ctrl.signal);
      const paint = () => { renderInspect(); };
      insp.results = [];
      const before = await Detectors.runAll(input, ctx, (r) => { insp.results.push(r); paint(); });
      insp.results = before;
      if (mode === "clean") {
        if (input.kind !== "text") { toast(t("inspectCleanTextOnly"), "⚠️"); }
        else {
          const { cleaned } = LayerA.clean(input.text, textOptions());
          insp.cleanedText = cleaned;
          $("inspect-status").textContent = t("inspectReRunning");
          const after = await Detectors.runAll({ kind: "text", text: cleaned }, ctx);
          insp.compare = Detectors.compare(before, after);
        }
      }
      renderInspect();
      $("inspect-status").textContent = "";
    } catch (e) {
      const reason = String((e && e.message) || e);
      $("inspect-status").textContent = reason === "cancelled" ? t("rewriteCancelled") : t("inspectFailed", { msg: reason });
    } finally {
      setInspectBusy(false); insp.ctrl = null;
    }
  }

  function inspectReport() {
    const res = insp.results || [];
    const strip = (r) => Object.assign({}, r, { note: noteText(r) || null, noteKey: undefined, noteParams: undefined });
    const input = inspectInput();
    const rep = {
      schema: "unmark-inspector/1", generated_at: new Date().toISOString(), page: location.origin + location.pathname,
      input: input.kind === "text" ? { kind: "text", length: input.text.length } : { kind: "file", name: input.name, bytes: input.u8.length },
      key_profile: $("inspect-key").value || "a",
      sidecar: insp.stat.enabled ? { enabled: true, model: insp.stat.model, detectors: insp.stat.detectors } : { enabled: false },
      results: res.map(strip), summary: Detectors.summarize(res),
    };
    if (insp.compare) rep.after_layer_a = { results: insp.compare.map((c) => c.after && strip(c.after)), unchanged: insp.compare.map((c) => ({ detector: c.detector, same: c.same })), summary: Detectors.summarize(insp.compare.map((c) => c.after || c.before)) };
    return rep;
  }

  function setInspectFile(file) {
    if (!file) { insp.input = null; $("inspect-file-name").textContent = ""; inspText.disabled = false; return; }
    file.arrayBuffer().then((buf) => {
      insp.input = { kind: "file", name: file.name, u8: new Uint8Array(buf) };
      $("inspect-file-name").textContent = t("inspectFileLoaded", { name: file.name, size: fmtBytes(file.size) });
      inspText.disabled = true;
      insp.results = null; insp.compare = null; renderInspect();
    });
  }

  async function runStatDemo() {
    if (insp.demoCtrl) return;
    const prompt = $("stat-demo-prompt").value.trim() || $("stat-demo-prompt").placeholder;
    insp.demoCtrl = new AbortController();
    $("btn-stat-demo").disabled = true; $("btn-stat-demo-cancel").hidden = false;
    $("stat-demo-status").textContent = t("statDemoBusy");
    try {
      const res = await WmApi.statGenerate({ prompt, scheme: $("stat-demo-scheme").value, keyProfile: $("stat-demo-key").value, maxNewTokens: Math.max(50, Math.min(1024, parseInt($("stat-demo-tokens").value, 10) || 400)) }, insp.demoCtrl.signal);
      const text = res && typeof res.text === "string" ? res.text : "";
      if (!text) throw new Error("empty response from the sidecar");
      setInspectFile(null); inspText.value = text; $("inspect-count").textContent = t("chars", { n: text.length });
      $("inspect-key").value = $("stat-demo-key").value;
      $("stat-demo-status").textContent = t("statDemoDone", { n: res.tokens || "?", scheme: res.scheme, key: String(res.key_profile || "").toUpperCase() });
      insp.results = null; insp.compare = null; renderInspect();
    } catch (e) {
      const reason = String((e && e.message) || e);
      $("stat-demo-status").textContent = reason === "cancelled" ? t("rewriteCancelled") : t("inspectFailed", { msg: reason });
    } finally {
      insp.demoCtrl = null; $("btn-stat-demo").disabled = false; $("btn-stat-demo-cancel").hidden = true;
    }
  }

  async function initInspect() {
    inspText.addEventListener("input", () => { $("inspect-count").textContent = t("chars", { n: inspText.value.length }); });
    $("btn-inspect-from-text").addEventListener("click", () => { setInspectFile(null); inspText.value = inputEl.value; inspText.dispatchEvent(new Event("input")); });
    $("btn-inspect-file").addEventListener("click", () => $("inspect-file-input").click());
    $("inspect-file-input").addEventListener("change", () => { const f = $("inspect-file-input").files[0]; if (f) setInspectFile(f); $("inspect-file-input").value = ""; });
    inspText.addEventListener("focus", () => { if (insp.input && insp.input.kind === "file") setInspectFile(null); });
    $("btn-inspect-run").addEventListener("click", () => runInspect("inspect"));
    $("btn-inspect-clean").addEventListener("click", () => runInspect("clean"));
    $("btn-inspect-cancel").addEventListener("click", () => { if (insp.ctrl) insp.ctrl.abort(); });
    $("btn-inspect-json").addEventListener("click", async () => {
      if (!insp.results) { toast(t("inspectEmptyReport"), "⚠️"); return; }
      try { await navigator.clipboard.writeText(JSON.stringify(inspectReport(), null, 2)); toast(t("copied")); }
      catch (_) { toast(t("copyFailed"), "⚠️"); }
    });
    try { const saved = JSON.parse(localStorage.getItem(INSPECT_KEY) || "{}"); if (saved.key === "a" || saved.key === "b") $("inspect-key").value = saved.key; } catch (_) { /* ignore */ }
    $("inspect-key").addEventListener("change", () => { try { localStorage.setItem(INSPECT_KEY, JSON.stringify({ key: $("inspect-key").value })); } catch (_) {} });
    $("btn-stat-demo").addEventListener("click", runStatDemo);
    $("btn-stat-demo-cancel").addEventListener("click", () => { if (insp.demoCtrl) insp.demoCtrl.abort(); });

    // Sidecar discovery: same-origin probe, hidden unless serve_local.py has a
    // configured --stat-upstream and the sidecar answers /health.
    let cfg = null;
    try { cfg = await WmApi.statConfig(); } catch (_) { /* hosted page or no proxy */ }
    if (cfg && cfg.enabled) {
      try {
        const h = await WmApi.statHealth();
        const dets = Array.isArray(h && h.detectors) ? h.detectors.filter((d) => d && d.available !== false).map((d) => d.id) : [];
        insp.stat = Object.assign(insp.stat, { enabled: true, detectors: dets, generate: h && h.generate !== false, model: (h && h.model) || "" });
      } catch (e) {
        insp.stat.enabled = false;
        $("stat-hint").textContent = t("statSidecarDown", { msg: String((e && e.message) || e) });
      }
    }
    $("inspect-key-wrap").hidden = !insp.stat.enabled;
    $("stat-demo-box").hidden = !(insp.stat.enabled && insp.stat.generate);
    $("stat-hint").hidden = insp.stat.enabled;
  }

  // ---------------------------------------------------------------- tabs (WAI-ARIA)
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  function selectTab(btn) {
    tabs.forEach((b) => {
      const on = b === btn;
      b.classList.toggle("active", on); b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1;
      const pane = $(b.getAttribute("aria-controls"));
      pane.classList.toggle("active", on); if (on) pane.removeAttribute("hidden"); else pane.setAttribute("hidden", "");
    });
  }
  tabs.forEach((b, i) => {
    b.addEventListener("click", () => selectTab(b));
    b.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return; e.preventDefault(); const n = tabs[(i + d + tabs.length) % tabs.length]; n.focus(); selectTab(n);
    });
  });

  // ---------------------------------------------------------------- files
  const dropzone = $("dropzone"), fileInput = $("file-input"), results = $("file-results-container");
  let liveUrls = [];
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
  dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dragover"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", (e) => { e.preventDefault(); dropzone.classList.remove("dragover"); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });
  fileInput.addEventListener("change", () => { if (fileInput.files.length) handleFiles(fileInput.files); fileInput.value = ""; });

  function card(file) {
    const c = el("div", "file-card");
    const info = el("div", "file-info");
    const icon = el("div", "file-icon", "⏳");
    const meta = el("div");
    meta.appendChild(el("div", "file-name", file.name));
    const status = el("div", "file-meta", t("fileWorking"));
    meta.appendChild(status);
    const findings = el("div", "file-findings");
    meta.appendChild(findings);
    info.append(icon, meta); c.appendChild(info);
    const actions = el("div", "file-actions"); c.appendChild(actions);
    return { c, icon, status, findings, actions };
  }

  async function handleFiles(list) {
    liveUrls.forEach((u) => URL.revokeObjectURL(u)); liveUrls = [];
    results.replaceChildren();
    const files = [...list];
    for (const f of files) await processFile(f); // sequential keeps memory bounded
    if (files.length > 1) toast(t("filesDone", { n: files.length }));
  }

  async function processFile(file) {
    const ui = card(file); results.appendChild(ui.c);
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const viaServer = useServer() && server.reachable;
    const limit = viaServer ? SERVER_MAX_BYTES : BROWSER_MAX_BYTES;
    try {
      if (file.size > limit) throw new Error(t("errTooLarge", { size: fmtBytes(file.size), limit: fmtBytes(limit), engine: viaServer ? t("viaServer") : t("viaBrowser") }));
      let out;
      if (viaServer) out = await cleanViaServer(file, ext);
      else out = await cleanInBrowser(file, ext);
      const url = URL.createObjectURL(out.blob); liveUrls.push(url);
      const newName = file.name.replace(/(\.[^.]+)?$/, (m) => `_cleaned${m || ""}`);
      ui.icon.textContent = out.suspicious ? "🧹" : "✅";
      ui.status.textContent = t("fileDone", { from: fmtBytes(file.size), to: fmtBytes(out.blob.size), engine: viaServer ? t("viaServer") : t("viaBrowser") });
      ui.findings.replaceChildren();
      for (const line of out.findings) ui.findings.appendChild(el("div", null, "• " + line));
      const a = el("a", "btn btn-primary", "💾 " + t("download")); a.href = url; a.download = newName; ui.actions.appendChild(a);
    } catch (e) {
      ui.c.classList.add("error"); ui.icon.textContent = "⚠️"; ui.status.classList.add("error");
      ui.status.textContent = e instanceof WmApi.ApiError ? t("errServer", { error: e.message }) : e.message;
    }
  }

  async function cleanInBrowser(file, ext) {
    if (IMAGE_EXT.has(ext)) {
      const u8 = new Uint8Array(await file.arrayBuffer());
      const before = ImageMeta.inspect(u8);
      const r = ImageMeta.clean(u8, { stripAllMetadata: !$("opt-keep-meta").checked });
      const mime = IMAGE_MIME[r.format] || "application/octet-stream";
      const findings = [];
      if (before.has_c2pa) findings.push(t("c2paFound")); else if (before.has_ai_metadata) findings.push(t("aiMetaFound"));
      findings.push(...before.findings, ...r.actions);
      return { blob: new Blob([r.data], { type: mime }), findings, suspicious: before.has_ai_metadata };
    }
    if (TEXT_EXT.has(ext)) {
      const text = await file.text();
      const { cleaned, stats } = LayerA.clean(text, textOptions());
      const findings = [];
      for (const [label, n] of Object.entries(stats.removed)) findings.push(t("removedTag", { n, label }));
      for (const [label, n] of Object.entries(stats.replaced)) findings.push(label === "NFKC_normalize" ? t("nfkcTag", { n }) : t("replacedTag", { n, label }));
      if (!findings.length) findings.push(t("cleanText"));
      if (ext !== "txt") findings.push(t("textOnlyNote"));
      return { blob: new Blob([cleaned], { type: file.type || "text/plain;charset=utf-8" }), findings, suspicious: stats.removed_count > 0 };
    }
    if (SERVER_ONLY_EXT.has(ext)) throw new Error(t("errNeedServer"));
    throw new Error(t("errUnsupported"));
  }

  async function cleanViaServer(file, ext) {
    const u8 = new Uint8Array(await file.arrayBuffer());
    const opts = textOptions();
    const options = { nfkc: opts.nfkc, aggressive_homoglyphs: opts.aggressiveHomoglyphs, keep_non_ai_metadata: $("opt-keep-meta").checked, also_layer_a_text: true };
    const insp = await WmApi.inspect(u8, file.name);
    const res = await WmApi.clean(u8, file.name, options);
    const data = WmApi.base64ToBytes(res.cleaned);
    const findings = [];
    const rep = insp.report || {};
    if (rep.has_c2pa) findings.push(t("c2paFound")); else if (rep.has_ai_metadata) findings.push(t("aiMetaFound"));
    if (Array.isArray(rep.findings)) findings.push(...rep.findings.map(String));
    if (Array.isArray(rep.hits)) for (const h of rep.hits) findings.push(`${h.kind}: ${h.label} ×${h.count}`);
    const r = res.report || {};
    if (Array.isArray(r.actions)) findings.push(...r.actions.map(String));
    if (r.stats) { for (const [label, n] of Object.entries(r.stats.removed || {})) findings.push(t("removedTag", { n, label })); for (const [label, n] of Object.entries(r.stats.replaced || {})) findings.push(t("replacedTag", { n, label })); }
    if (!findings.length) findings.push(t("cleanText"));
    return { blob: new Blob([data], { type: file.type || "application/octet-stream" }), findings, suspicious: !!insp.suspicious };
  }

  // ---------------------------------------------------------------- theme & language
  function applyTheme(mode) {
    document.body.setAttribute("data-theme", mode);
    $("btn-theme").textContent = mode === "dark" ? "🌙" : "☀️";
    $("btn-theme").setAttribute("aria-pressed", String(mode === "dark"));
  }
  const THEME_KEY = "unmark-web.theme";
  const THEME_KEY_LEGACY = "watermarks-remover-web.theme";  // key used before the rename
  function savedTheme() {
    try { return localStorage.getItem(THEME_KEY) || localStorage.getItem(THEME_KEY_LEGACY); } catch (_) { return null; }
  }
  function initTheme() {
    const saved = savedTheme();
    const mq = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)");
    applyTheme(saved || (mq && mq.matches ? "light" : "dark"));
    if (mq && mq.addEventListener) mq.addEventListener("change", (e) => { if (!savedTheme()) applyTheme(e.matches ? "light" : "dark"); });
    $("btn-theme").addEventListener("click", () => {
      const next = document.body.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(next); try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
    });
  }
  function initLang() {
    I18n.setLang(I18n.detect());
    const sel = $("sel-lang");
    for (const l of I18n.LANGS) {                       // options come from the dictionary list
      const opt = document.createElement("option");
      opt.value = l.code; opt.textContent = l.name;
      sel.appendChild(opt);
    }
    sel.value = I18n.lang;
    sel.addEventListener("change", () => {
      I18n.setLang(sel.value);
      sel.value = I18n.lang;                            // setLang normalises unknown codes
      I18n.save();
      runText(); renderEngineState(); applyRewritePromptDefault(); renderInspect();
    });
  }

  initTheme(); initLang(); initSettings(); runText(); renderEngineState(); initRewrite(); initInspect();
})();
