/* UI strings. Elements opt in with data-i18n / data-i18n-title / data-i18n-placeholder /
 * data-i18n-content / data-i18n-html. `t(key, params)` for dynamic strings. */
(function (root) {
  "use strict";

  const UPSTREAM = "https://github.com/guillaumemeyer/watermarks-remover";
  const REPO = "https://github.com/ivanusto/watermarks-remover-web";

  const dict = {
    en: {
      docTitle: "AI Watermarks Remover — Web",
      docDesc: "Browser-first web client for watermarks-remover: strip invisible Unicode marks and C2PA/EXIF/XMP metadata locally, or drive the Python service.",
      skipLink: "Skip to content",
      appTitle: "AI Watermarks & Provenance Remover",
      appSub: "Web client for watermarks-remover · Layer A + image metadata",
      btnLangTitle: "切換為繁體中文", btnThemeTitle: "Toggle light/dark theme", btnSettingsTitle: "Server settings",
      engineBrowser: "Browser engine", engineServer: "Server: {url} (v{version})",
      engineDescBrowser: "Everything runs in this browser tab. Nothing is uploaded unless you configure a server.",
      engineDescServer: "Files are sent to the server you configured; the browser engine remains available for text and images.",
      engineDescServerDown: "Configured server is unreachable — falling back to the browser engine.",
      settingsTitle: "Server connection (optional)",
      srvUrl: "Service URL", srvKey: "API key (Bearer, optional)", srvRemember: "Remember in this browser",
      btnTest: "Test connection", btnForget: "Forget",
      srvOk: "✅ Connected — v{version}{caps}", srvFail: "⚠️ {error}", srvTesting: "Testing…",
      enginePref: "Engine:", engineAuto: "Auto (server if reachable)", engineBrowserOnly: "Browser only", engineServerOnly: "Server only",
      settingsNote: `Run the upstream service with <code>python3 service/scripts/server.py</code> (or its Docker image). It binds to 127.0.0.1:8765 and sends no CORS headers by default, so this page can only reach it when served from the same origin, or when the server allows this page's origin — see the README section <em>Connecting a server</em>. Docs: <a href="${UPSTREAM}/tree/main/service" target="_blank" rel="noopener noreferrer">service/</a>.`,
      tabText: "Text (Layer A)", tabFile: "Files & images (metadata / C2PA)",
      optSpaces: "Normalize space homoglyphs", optSpacesTitle: "Replace NBSP, thin/em/ideographic spaces etc. with U+0020",
      optNfkc: "NFKC normalize", optNfkcTitle: "Apply Unicode NFKC after cleaning (fullwidth → ASCII, ligatures…)",
      optLatin: "Replace Latin confusables (aggressive)", optLatinTitle: "Map Cyrillic/fullwidth lookalikes to ASCII letters — may alter legit non-Latin text",
      optGlue: "Strip emoji/script glue too (paranoid)", optGlueTitle: "Also remove ZWJ/VS16 after emoji, ZWNJ/ZWJ inside Persian/Indic words, flag tag chars…",
      btnSample: "Load sample", inputHeader: "Original text", outputHeader: "Cleaned text",
      inputPlaceholder: "Paste text from ChatGPT / Claude / Gemini / a PDF…", chars: "{n} chars",
      reportTitle: "Findings", btnClear: "Clear", btnCopy: "Copy cleaned text",
      copied: "Cleaned text copied", copyFailed: "Copy failed — select the text manually",
      cleanText: "✅ No Layer A carriers found", removedTag: "removed {n}× {label}", replacedTag: "replaced {n}× {label}",
      nfkcTag: "NFKC changed {n} chars", kindTag: "{kind}",
      dropTitle: "Drop files here, or press Enter to browse",
      dropDescBrowser: "Browser engine: PNG, JPEG, WebP (metadata), TXT/MD/HTML/SVG (Layer A text only). PDF, DOCX, ODT need a server.",
      dropDescServer: "Server engine: PNG, JPEG, WebP, SVG, PDF, DOCX, ODT, HTML, Markdown, TXT.",
      optKeepMeta: "Keep non-AI metadata (only drop AI/C2PA hits)", optKeepMetaTitle: "Default strips all EXIF/XMP/text chunks. Tick to keep e.g. camera EXIF and only drop AI/C2PA-tagged blocks.",
      fileWorking: "Processing…", fileDone: "{from} → {to} · {engine}", download: "Download",
      viaBrowser: "browser", viaServer: "server",
      errTooLarge: "File is {size} — over the {limit} limit for the {engine} engine.",
      errNeedServer: "This format needs the Python service. Configure a server (⚙️) or use the CLI.",
      errUnsupported: "Unsupported file type.",
      errServer: "Server error: {error}",
      textOnlyNote: "Layer A only — metadata tags inside HTML/SVG/Markdown are left as-is in browser mode; use a server for full container cleaning.",
      imgClean: "No metadata chunks removed (already clean).",
      c2paFound: "C2PA / Content Credentials found and removed", aiMetaFound: "AI metadata hints found and removed",
      filesDone: "{n} file(s) processed",
      footerCredit: `Independent web client for <a href="${UPSTREAM}" target="_blank" rel="noopener noreferrer">guillaumemeyer/watermarks-remover</a> (MIT) — same rules, ported to JavaScript and parity-tested. Source: <a href="${REPO}" target="_blank" rel="noopener noreferrer">ivanusto/watermarks-remover-web</a> (MIT). Not affiliated with the upstream project.`,
      footerPrivacy: "No analytics, no web fonts, no third-party requests. Network calls only go to the server URL you configure.",
      sample: "This is a​sample with​zero-width﻿characters, a soft­hyphen, a ‮reversed‬ run,　an ideographic space, Cyrillic ао confusables, and preserved emoji ❤️‍🔥 plus می‌روم (Persian ZWNJ).",
    },
    zh: {
      docTitle: "AI 浮水印清除器 — 網頁版",
      docDesc: "watermarks-remover 的瀏覽器優先網頁客戶端：在本機清除隱形 Unicode 標記與 C2PA/EXIF/XMP 中繼資料，或連線 Python 服務。",
      skipLink: "跳到主要內容",
      appTitle: "AI 浮水印與來源標記清除器",
      appSub: "watermarks-remover 網頁客戶端 · Layer A + 圖片中繼資料",
      btnLangTitle: "Switch to English", btnThemeTitle: "切換深色／淺色主題", btnSettingsTitle: "伺服器設定",
      engineBrowser: "瀏覽器引擎", engineServer: "伺服器：{url}（v{version}）",
      engineDescBrowser: "所有運算都在這個瀏覽器分頁完成；除非你設定伺服器，否則不會上傳任何內容。",
      engineDescServer: "檔案會送到你設定的伺服器；文字與圖片仍可使用瀏覽器引擎。",
      engineDescServerDown: "設定的伺服器無法連線，已改用瀏覽器引擎。",
      settingsTitle: "伺服器連線（選用）",
      srvUrl: "服務網址", srvKey: "API 金鑰（Bearer，選用）", srvRemember: "記住在此瀏覽器",
      btnTest: "測試連線", btnForget: "清除設定",
      srvOk: "✅ 已連線 — v{version}{caps}", srvFail: "⚠️ {error}", srvTesting: "測試中…",
      enginePref: "引擎：", engineAuto: "自動（可連線時用伺服器）", engineBrowserOnly: "只用瀏覽器", engineServerOnly: "只用伺服器",
      settingsNote: `啟動上游服務：<code>python3 service/scripts/server.py</code>（或其 Docker 映像）。預設只綁定 127.0.0.1:8765 且不送 CORS 標頭，因此本頁只有在同源提供、或伺服器允許本頁來源時才能連上——請見 README 的〈Connecting a server〉。文件：<a href="${UPSTREAM}/tree/main/service" target="_blank" rel="noopener noreferrer">service/</a>。`,
      tabText: "文字（Layer A）", tabFile: "檔案與圖片（中繼資料／C2PA）",
      optSpaces: "正規化同形空白", optSpacesTitle: "把 NBSP、細空白、全形空白等替換為 U+0020",
      optNfkc: "NFKC 正規化", optNfkcTitle: "清洗後套用 Unicode NFKC（全形→半形、連字…）",
      optLatin: "替換拉丁同形字（激進）", optLatinTitle: "把西里爾／全形的相似字母改為 ASCII——可能改動正當的非拉丁文字",
      optGlue: "連 emoji／文字接合符也剝除（偏執模式）", optGlueTitle: "同時移除 emoji 後的 ZWJ/VS16、波斯文／印度系文字內的 ZWNJ/ZWJ、旗幟 tag 字元…",
      btnSample: "載入範例", inputHeader: "原始文字", outputHeader: "清洗後文字",
      inputPlaceholder: "貼上來自 ChatGPT / Claude / Gemini / PDF 的文字…", chars: "{n} 字元",
      reportTitle: "檢測結果", btnClear: "清空", btnCopy: "複製清洗後文字",
      copied: "已複製清洗後文字", copyFailed: "複製失敗，請手動選取",
      cleanText: "✅ 未發現 Layer A 載體", removedTag: "移除 {n}× {label}", replacedTag: "替換 {n}× {label}",
      nfkcTag: "NFKC 變動 {n} 字元", kindTag: "{kind}",
      dropTitle: "拖曳檔案到此，或按 Enter 選擇檔案",
      dropDescBrowser: "瀏覽器引擎：PNG、JPEG、WebP（中繼資料），TXT/MD/HTML/SVG（僅 Layer A 文字）。PDF、DOCX、ODT 需要伺服器。",
      dropDescServer: "伺服器引擎：PNG、JPEG、WebP、SVG、PDF、DOCX、ODT、HTML、Markdown、TXT。",
      optKeepMeta: "保留非 AI 中繼資料（只移除 AI／C2PA 命中）", optKeepMetaTitle: "預設剝除所有 EXIF/XMP/文字區塊；勾選則保留例如相機 EXIF，只移除含 AI/C2PA 標記的區塊。",
      fileWorking: "處理中…", fileDone: "{from} → {to} · {engine}", download: "下載",
      viaBrowser: "瀏覽器", viaServer: "伺服器",
      errTooLarge: "檔案 {size}，超過 {engine} 引擎的 {limit} 上限。",
      errNeedServer: "此格式需要 Python 服務。請設定伺服器（⚙️）或改用 CLI。",
      errUnsupported: "不支援的檔案類型。",
      errServer: "伺服器錯誤：{error}",
      textOnlyNote: "僅 Layer A——瀏覽器模式不處理 HTML/SVG/Markdown 內的中繼資料標籤；完整容器清洗請使用伺服器。",
      imgClean: "沒有可移除的中繼資料區塊（已是乾淨檔案）。",
      c2paFound: "發現並移除 C2PA / Content Credentials", aiMetaFound: "發現並移除 AI 中繼資料線索",
      filesDone: "已處理 {n} 個檔案",
      footerCredit: `<a href="${UPSTREAM}" target="_blank" rel="noopener noreferrer">guillaumemeyer/watermarks-remover</a>（MIT）的獨立網頁客戶端——相同規則移植為 JavaScript 並經一致性測試。原始碼：<a href="${REPO}" target="_blank" rel="noopener noreferrer">ivanusto/watermarks-remover-web</a>（MIT）。與上游專案無隸屬關係。`,
      footerPrivacy: "無分析追蹤、無網頁字型、無第三方請求。網路呼叫只會送往你設定的伺服器網址。",
      sample: "這是一段帶有​零寬空格﻿與­軟連字號的‮測試文字‬，含　全形空白、西里爾同形字 ао，以及應被保留的 emoji ❤️‍🔥 和 می‌روم（波斯文 ZWNJ）。",
    },
  };

  let lang = "en";
  function t(key, params) {
    let s = (dict[lang] && dict[lang][key]) || dict.en[key] || key;
    if (params) for (const k of Object.keys(params)) s = s.split("{" + k + "}").join(String(params[k]));
    return s;
  }
  function apply(root_) {
    const doc = root_ || document;
    doc.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.getAttribute("data-i18n")); });
    doc.querySelectorAll("[data-i18n-title]").forEach((el) => { const v = t(el.getAttribute("data-i18n-title")); el.title = v; if (el.hasAttribute("aria-label")) el.setAttribute("aria-label", v); });
    doc.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.getAttribute("data-i18n-placeholder")); });
    doc.querySelectorAll("[data-i18n-content]").forEach((el) => { el.setAttribute("content", t(el.getAttribute("data-i18n-content"))); });
    doc.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.getAttribute("data-i18n-html")); }); // dictionary-only HTML, never user input
    document.documentElement.lang = lang === "zh" ? "zh-Hant" : "en";
  }
  function setLang(l) { lang = dict[l] ? l : "en"; apply(); }
  function detect() {
    try { const s = localStorage.getItem("watermarks-remover-web.lang"); if (s && dict[s]) return s; } catch (_) {}
    return /^zh/i.test(navigator.language || "") ? "zh" : "en";
  }
  root.I18n = { t, apply, setLang, detect, get lang() { return lang; } };
})(typeof globalThis !== "undefined" ? globalThis : this);
