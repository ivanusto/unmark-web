/* UI wiring. No inline HTML from user data — every user-controlled string goes through textContent. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const t = (k, p) => I18n.t(k, p);

  const BROWSER_MAX_BYTES = 64 << 20;   // 64 MiB — keeps memory sane in a tab
  const SERVER_MAX_BYTES = 256 << 20;   // upstream WATERMARKS_MAX_INPUT_BYTES default
  const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "avif", "heic", "heif"]);
  const TEXT_EXT = new Set(["txt", "md", "markdown", "html", "htm", "svg"]);
  const SERVER_ONLY_EXT = new Set(["pdf", "docx", "odt"]);

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
    if (!text) { outputEl.textContent = ""; $("char-count-in").textContent = t("chars", { n: 0 }); $("char-count-out").textContent = t("chars", { n: 0 }); box.classList.remove("show"); return; }
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
      const mime = r.format === "png" ? "image/png" : r.format === "jpeg" ? "image/jpeg" : "image/webp";
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
      runText(); renderEngineState();
    });
  }

  initTheme(); initLang(); initSettings(); runText(); renderEngineState();
})();
