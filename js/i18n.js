/* UI strings. Elements opt in with data-i18n / data-i18n-title / data-i18n-placeholder /
 * data-i18n-content / data-i18n-html. `t(key, params)` for dynamic strings. */
(function (root) {
  "use strict";

  const UPSTREAM = "https://github.com/guillaumemeyer/watermarks-remover";
  const REPO = "https://github.com/ivanusto/unmark-web";

  const LS_KEY = "unmark-web.lang";
  const LS_KEY_LEGACY = "watermarks-remover-web.lang";  // key used before the rename

  /* Supported locales, in switcher order. `code` is also the <html lang> value and what
   * gets stored in localStorage; `name` is written in the language itself. Adding a
   * locale = one entry here + one dictionary below; nothing else is hard-coded. */
  const LANGS = [
    { code: "en", name: "English" },
    { code: "zh-Hant", name: "繁體中文" },
    { code: "zh-Hans", name: "简体中文" },
  ];

  /* Lookup chain tried before `en` when a key is missing. Chinese falls back across
   * scripts first — for a Chinese reader the other script beats English. */
  const FALLBACK = { "zh-Hant": ["zh-Hans"], "zh-Hans": ["zh-Hant"] };

  const dict = {
    en: {
      docTitle: "Unmark — invisible marks & metadata remover",
      docDesc: "Unmark is a browser-first web client: strip invisible Unicode marks and C2PA/EXIF/XMP metadata locally, or drive the watermarks-remover Python service.",
      skipLink: "Skip to content",
      appTitle: "Unmark",
      appSub: "Invisible Unicode marks & image metadata · works with watermarks-remover",
      btnLangTitle: "Interface language", btnThemeTitle: "Toggle light/dark theme", btnSettingsTitle: "Server settings",
      engineBrowser: "On this device", engineServer: "Server: {url} (v{version})",
      engineDescBrowser: "Your files never leave this device. Everything is processed inside your browser — nothing is uploaded.",
      engineDescServer: "Files are sent to the server you connected; text and images are still handled on this device.",
      engineDescServerDown: "The server you configured can't be reached — processing here instead.",
      settingsTitle: "Server connection (optional)",
      srvUrl: "Service URL", srvKey: "API key (Bearer, optional)", srvRemember: "Remember in this browser",
      btnTest: "Test connection", btnForget: "Forget",
      srvOk: "✅ Connected — v{version}{caps}", srvFail: "⚠️ {error}", srvTesting: "Testing…",
      enginePref: "Processing:", engineAuto: "Auto (use the server when reachable)", engineBrowserOnly: "On this device only", engineServerOnly: "Server only",
      settingsNote: `Run the upstream service with <code>python3 service/scripts/server.py</code> (or its Docker image). It binds to 127.0.0.1:8765 and sends no CORS headers (by design), so this page can only reach it when served from the same origin, e.g. via <code>serve_local.py</code>, or through a reverse proxy that allows this page's origin — see the README section <em>Connecting a server</em>. Docs: <a href="${UPSTREAM}/tree/main/service" target="_blank" rel="noopener noreferrer">service/</a>.`,
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
      dropDescBrowser: "On this device: PNG, JPEG, WebP, AVIF, HEIC (metadata), TXT/MD/HTML/SVG (Layer A text only). PDF, DOCX, ODT need a server.",
      dropDescServer: "Via the server: PNG, JPEG, WebP, AVIF, HEIC, SVG, PDF, DOCX, ODT, HTML, Markdown, TXT.",
      optKeepMeta: "Keep non-AI metadata (only drop AI/C2PA hits)", optKeepMetaTitle: "Default strips all EXIF/XMP/text chunks. Tick to keep e.g. camera EXIF and only drop AI/C2PA-tagged blocks.",
      fileWorking: "Processing…", fileDone: "{from} → {to} · {engine}", download: "Download",
      viaBrowser: "on this device", viaServer: "server",
      errTooLarge: "File is {size} — over the {limit} limit ({engine}).",
      errNeedServer: "This format needs the Python service. Connect a server (⚙️) or use the CLI.",
      errUnsupported: "Unsupported file type.",
      errServer: "Server error: {error}",
      textOnlyNote: "Layer A only — metadata tags inside HTML/SVG/Markdown are left as-is when processing here; connect a server for full container cleaning.",
      imgClean: "No metadata chunks removed (already clean).",
      c2paFound: "C2PA / Content Credentials found and removed", aiMetaFound: "AI metadata hints found and removed",
      filesDone: "{n} file(s) processed",
      footerCredit: `Independent web client for <a href="${UPSTREAM}" target="_blank" rel="noopener noreferrer">guillaumemeyer/watermarks-remover</a> (MIT) — same rules, ported to JavaScript and parity-tested. Source: <a href="${REPO}" target="_blank" rel="noopener noreferrer">ivanusto/unmark-web</a> (MIT). Not affiliated with the upstream project.`,
      footerPrivacy: "No analytics, no web fonts, no third-party requests. Network calls only go to the server URL you configure.",
      sample: "This is a​sample with​zero-width﻿characters, a soft­hyphen, a ‮reversed‬ run,　an ideographic space, Cyrillic ао confusables, and preserved emoji ❤️‍🔥 plus می‌روم (Persian ZWNJ).",
    },
    "zh-Hant": {
      docTitle: "Unmark — 隱形標記與中繼資料清除器",
      docDesc: "Unmark 是瀏覽器優先的網頁客戶端：在本機清除隱形 Unicode 標記與 C2PA/EXIF/XMP 中繼資料，或連線 watermarks-remover 的 Python 服務。",
      skipLink: "跳到主要內容",
      appTitle: "Unmark",
      appSub: "隱形 Unicode 標記與圖片中繼資料 · 搭配 watermarks-remover",
      btnLangTitle: "介面語言", btnThemeTitle: "切換深色／淺色主題", btnSettingsTitle: "伺服器設定",
      engineBrowser: "本機處理", engineServer: "伺服器：{url}（v{version}）",
      engineDescBrowser: "你的檔案不會離開這台電腦。所有處理都在瀏覽器裡完成，不會上傳。",
      engineDescServer: "檔案會傳到你連接的伺服器處理；文字與圖片仍在本機完成。",
      engineDescServerDown: "連不上你設定的伺服器，已改在本機處理。",
      settingsTitle: "伺服器連線（選用）",
      srvUrl: "服務網址", srvKey: "API 金鑰（Bearer，選用）", srvRemember: "記住在此瀏覽器",
      btnTest: "測試連線", btnForget: "清除設定",
      srvOk: "✅ 已連線 — v{version}{caps}", srvFail: "⚠️ {error}", srvTesting: "測試中…",
      enginePref: "處理方式：", engineAuto: "自動（可連線時用伺服器）", engineBrowserOnly: "只在本機", engineServerOnly: "只用伺服器",
      settingsNote: `啟動上游服務：<code>python3 service/scripts/server.py</code>（或其 Docker 映像）。只綁定 127.0.0.1:8765 且刻意不送 CORS 標頭，因此本頁只有在同源提供（例如透過 <code>serve_local.py</code>）、或前方反向代理允許本頁來源時才能連上——請見 README 的〈Connecting a server〉。文件：<a href="${UPSTREAM}/tree/main/service" target="_blank" rel="noopener noreferrer">service/</a>。`,
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
      dropDescBrowser: "本機可處理：PNG、JPEG、WebP、AVIF、HEIC（中繼資料），TXT/MD/HTML/SVG（僅 Layer A 文字）。PDF、DOCX、ODT 需要伺服器。",
      dropDescServer: "透過伺服器可處理：PNG、JPEG、WebP、AVIF、HEIC、SVG、PDF、DOCX、ODT、HTML、Markdown、TXT。",
      optKeepMeta: "保留非 AI 中繼資料（只移除 AI／C2PA 命中）", optKeepMetaTitle: "預設剝除所有 EXIF/XMP/文字區塊；勾選則保留例如相機 EXIF，只移除含 AI/C2PA 標記的區塊。",
      fileWorking: "處理中…", fileDone: "{from} → {to} · {engine}", download: "下載",
      viaBrowser: "本機處理", viaServer: "伺服器",
      errTooLarge: "檔案 {size}，超過上限 {limit}（{engine}）。",
      errNeedServer: "此格式需要 Python 服務。請連接伺服器（⚙️）或改用 CLI。",
      errUnsupported: "不支援的檔案類型。",
      errServer: "伺服器錯誤：{error}",
      textOnlyNote: "僅 Layer A——在本機處理時不會清除 HTML/SVG/Markdown 內的中繼資料標籤；完整容器清洗請連接伺服器。",
      imgClean: "沒有可移除的中繼資料區塊（已是乾淨檔案）。",
      c2paFound: "發現並移除 C2PA / Content Credentials", aiMetaFound: "發現並移除 AI 中繼資料線索",
      filesDone: "已處理 {n} 個檔案",
      footerCredit: `<a href="${UPSTREAM}" target="_blank" rel="noopener noreferrer">guillaumemeyer/watermarks-remover</a>（MIT）的獨立網頁客戶端——相同規則移植為 JavaScript 並經一致性測試。原始碼：<a href="${REPO}" target="_blank" rel="noopener noreferrer">ivanusto/unmark-web</a>（MIT）。與上游專案無隸屬關係。`,
      footerPrivacy: "無分析追蹤、無網頁字型、無第三方請求。網路呼叫只會送往你設定的伺服器網址。",
      sample: "這是一段帶有​零寬空格﻿與­軟連字號的‮測試文字‬，含　全形空白、西里爾同形字 ао，以及應被保留的 emoji ❤️‍🔥 和 می‌روم（波斯文 ZWNJ）。",
    },
    "zh-Hans": {
      docTitle: "Unmark — 隐形标记与元数据清除器",
      docDesc: "Unmark 是浏览器优先的网页客户端：在本地清除隐形 Unicode 标记与 C2PA/EXIF/XMP 元数据，或连接 watermarks-remover 的 Python 服务。",
      skipLink: "跳到主要内容",
      appTitle: "Unmark",
      appSub: "隐形 Unicode 标记与图片元数据 · 搭配 watermarks-remover",
      btnLangTitle: "界面语言", btnThemeTitle: "切换深色／浅色主题", btnSettingsTitle: "服务器设置",
      engineBrowser: "本机处理", engineServer: "服务器：{url}（v{version}）",
      engineDescBrowser: "你的文件不会离开这台电脑。所有处理都在浏览器里完成，不会上传。",
      engineDescServer: "文件会传到你连接的服务器处理；文本与图片仍在本机完成。",
      engineDescServerDown: "连不上你设置的服务器，已改在本机处理。",
      settingsTitle: "服务器连接（可选）",
      srvUrl: "服务地址", srvKey: "API 密钥（Bearer，可选）", srvRemember: "记住在此浏览器",
      btnTest: "测试连接", btnForget: "清除设置",
      srvOk: "✅ 已连接 — v{version}{caps}", srvFail: "⚠️ {error}", srvTesting: "测试中…",
      enginePref: "处理方式：", engineAuto: "自动（可连接时用服务器）", engineBrowserOnly: "只在本机", engineServerOnly: "只用服务器",
      settingsNote: `启动上游服务：<code>python3 service/scripts/server.py</code>（或其 Docker 镜像）。它只绑定 127.0.0.1:8765 且刻意不发送 CORS 标头，因此本页只有在同源提供（例如通过 <code>serve_local.py</code>）、或前方反向代理允许本页来源时才能连上——请见 README 的〈Connecting a server〉。文档：<a href="${UPSTREAM}/tree/main/service" target="_blank" rel="noopener noreferrer">service/</a>。`,
      tabText: "文本（Layer A）", tabFile: "文件与图片（元数据／C2PA）",
      optSpaces: "规范化同形空格", optSpacesTitle: "把 NBSP、细空格、全角空格等替换为 U+0020",
      optNfkc: "NFKC 规范化", optNfkcTitle: "清洗后应用 Unicode NFKC（全角→半角、连字…）",
      optLatin: "替换拉丁同形字（激进）", optLatinTitle: "把西里尔／全角的相似字母改为 ASCII——可能改动正常的非拉丁文字",
      optGlue: "连 emoji／文字连接符也剥除（偏执模式）", optGlueTitle: "同时移除 emoji 后的 ZWJ/VS16、波斯语／印度系文字内的 ZWNJ/ZWJ、旗帜 tag 字符…",
      btnSample: "加载示例", inputHeader: "原始文本", outputHeader: "清洗后文本",
      inputPlaceholder: "粘贴来自 ChatGPT / Claude / Gemini / PDF 的文本…", chars: "{n} 字符",
      reportTitle: "检测结果", btnClear: "清空", btnCopy: "复制清洗后文本",
      copied: "已复制清洗后文本", copyFailed: "复制失败，请手动选取",
      cleanText: "✅ 未发现 Layer A 载体", removedTag: "移除 {n}× {label}", replacedTag: "替换 {n}× {label}",
      nfkcTag: "NFKC 变动 {n} 字符", kindTag: "{kind}",
      dropTitle: "拖放文件到此，或按 Enter 选择文件",
      dropDescBrowser: "本机可处理：PNG、JPEG、WebP、AVIF、HEIC（元数据），TXT/MD/HTML/SVG（仅 Layer A 文本）。PDF、DOCX、ODT 需要服务器。",
      dropDescServer: "通过服务器可处理：PNG、JPEG、WebP、AVIF、HEIC、SVG、PDF、DOCX、ODT、HTML、Markdown、TXT。",
      optKeepMeta: "保留非 AI 元数据（仅移除 AI／C2PA 命中）", optKeepMetaTitle: "默认剥除所有 EXIF/XMP/文本块；勾选则保留例如相机 EXIF，仅移除含 AI/C2PA 标记的块。",
      fileWorking: "处理中…", fileDone: "{from} → {to} · {engine}", download: "下载",
      viaBrowser: "本机处理", viaServer: "服务器",
      errTooLarge: "文件 {size}，超过上限 {limit}（{engine}）。",
      errNeedServer: "此格式需要 Python 服务。请连接服务器（⚙️）或改用 CLI。",
      errUnsupported: "不支持的文件类型。",
      errServer: "服务器错误：{error}",
      textOnlyNote: "仅 Layer A——在本机处理时不会清除 HTML/SVG/Markdown 内的元数据标签；完整容器清洗请连接服务器。",
      imgClean: "没有可移除的元数据块（已是干净文件）。",
      c2paFound: "发现并移除 C2PA / Content Credentials", aiMetaFound: "发现并移除 AI 元数据线索",
      filesDone: "已处理 {n} 个文件",
      footerCredit: `<a href="${UPSTREAM}" target="_blank" rel="noopener noreferrer">guillaumemeyer/watermarks-remover</a>（MIT）的独立网页客户端——相同规则移植为 JavaScript 并经一致性测试。源代码：<a href="${REPO}" target="_blank" rel="noopener noreferrer">ivanusto/unmark-web</a>（MIT）。与上游项目无隶属关系。`,
      footerPrivacy: "无统计分析、无网页字体、无第三方请求。网络请求只会发往你设置的服务器地址。",
      // Carries the same invisible characters as the other samples: ZWSP, BOM, SHY,
      // RLO/PDF, ideographic space, emoji VS16+ZWJ, Persian ZWNJ.
      sample: "这是一段带有​零宽空格﻿与­软连字符的‮测试文本‬，含　全角空格、西里尔同形字 ао，以及应被保留的 emoji ❤️‍🔥 和 می‌روم（波斯语 ZWNJ）。",
    },
  };

  let lang = "en";

  /* Map any BCP-47 tag to a supported code, or null. Bare "zh" resolves to Simplified,
   * following CLDR's default script for the language. */
  function normalize(tag) {
    const s = String(tag || "").toLowerCase().replace(/_/g, "-");
    if (s === "zh" || s.indexOf("zh-") === 0) {
      return /(^|-)(hant|tw|hk|mo)(-|$)/.test(s) ? "zh-Hant" : "zh-Hans";
    }
    if (s === "en" || s.indexOf("en-") === 0) return "en";
    return null;
  }

  function lookup(key) {
    const chain = [lang].concat(FALLBACK[lang] || [], "en");
    for (const code of chain) {
      const v = dict[code] && dict[code][key];
      if (v) return v;
    }
    return key;
  }
  function t(key, params) {
    let s = lookup(key);
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
    document.documentElement.lang = lang;
  }
  function setLang(l) { lang = dict[l] ? l : (normalize(l) || "en"); apply(); }
  function save() { try { localStorage.setItem(LS_KEY, lang); } catch (_) {} }
  function detect() {
    let saved = null;
    try { saved = localStorage.getItem(LS_KEY) || localStorage.getItem(LS_KEY_LEGACY); } catch (_) {}
    if (saved) {
      if (dict[saved]) return saved;
      if (saved === "zh") return "zh-Hant";  // legacy: "zh" was the Traditional dictionary
      const n = normalize(saved);
      if (n) return n;
    }
    const tags = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language];
    for (const tag of tags) {
      const n = normalize(tag);
      if (n && dict[n]) return n;
    }
    return "en";
  }
  root.I18n = { t, apply, setLang, save, detect, normalize, LANGS, get lang() { return lang; } };
})(typeof globalThis !== "undefined" ? globalThis : this);
