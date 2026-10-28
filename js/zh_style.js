/* Chinese AI-cadence heuristic (zh-Hant and zh-Hans).
 *
 * Not a port. Upstream score_stylometry.py and js/stylometry.js only know
 * English: their phrase table is English, sentences split on [.!?] and words
 * on \w runs, so a page of textbook model Chinese scores "low" with zero
 * markers. This module is the CJK counterpart and is owned by this repo, so
 * there is no parity test for it and no upstream anchor in the manifest.
 *
 * Like stylometry it is a heuristic. A hit means "reads like stock model
 * prose", never "was generated": plenty of people write 此外 and 總而言之, and
 * a model told to avoid them will. js/detectors.js caps it at "uncertain".
 *
 * Patterns are written in Traditional characters. Simplified input is mapped
 * one character to one character first (ZH_FOLD), so every offset into the
 * folded text is also an offset into the original and spans stay valid.
 */
(function (root) {
  "use strict";

  // Simplified -> Traditional for the characters the patterns below use. One
  // code unit each way, so folding never moves an index.
  const ZH_FOLD_PAIRS =
    "总總么麼随隨着著当當时時综綜让讓们們为為发發来來说說关關键鍵视視举舉轻輕远遠响響维維" +
    "战戰机機双雙纪紀这這个個会會赋賦态態环環闭閉盖蓋讨討浅淺结結论論与與仅僅见見对對帮幫" +
    "挥揮坚堅实實撑撐础礎话話题題应應该該显顯业業务務驱驅动動创創进進质質产產优優势勢价價" +
    "体體验驗领領层層级級统統规規划劃稳穩换換种種极極经經历歷华華丽麗伟偉蓝藍图圖开開启啟" +
    "迈邁无無缝縫链鏈释釋潜潛头頭阶階节節点點线線观觀灵靈归歸纳納简簡问問疑疑兴興趋趨鉴鑑" +
    "强強举舉际際满滿还還从從样樣么麼该該边邊过過这這谈談认認识識处處让讓总總带帶将將据據" +
    "专專门門众眾传傳统統运運营營销銷广廣积積极極协協调調济濟软軟硬硬网網络絡数數据據库庫" +
    "设設计計术術资資讯訊终終够夠况況效效录錄议議选選择擇项項标標准準则則严嚴谨謹确確" +
    "并並证證现現场場课課转轉变變蜕蛻尽盡纯純竞競赛賽" +
    "于於断斷飞飛续續长長携攜轨軌衔銜剑劍独獨单單后後写寫须須";
  const ZH_FOLD = new Map();
  for (let i = 0; i + 1 < ZH_FOLD_PAIRS.length; i += 2) ZH_FOLD.set(ZH_FOLD_PAIRS[i], ZH_FOLD_PAIRS[i + 1]);

  function fold(text) {
    let out = "";
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      out += ZH_FOLD.get(c) || c;
    }
    return out;
  }

  // [pattern, label, weight, category]. N = "any run inside one sentence".
  const N = "[^。！？!?\\n]";
  const ZH_PATTERNS = [
    // stock transitions
    ["值得(?:一提|注意|關注|強調|留意)的是", "值得一提的是", 1.2, "transition"],
    ["不僅如此", "不僅如此", 1.0, "transition"],
    ["與此同時", "與此同時", 0.7, "transition"],
    ["除此之外", "除此之外", 0.6, "transition"],
    ["此外[，,]", "此外，", 0.5, "transition"],
    ["換句話說|換言之", "換句話說", 0.5, "transition"],
    ["毫無疑問|無疑(?:是|地)", "毫無疑問", 0.9, "transition"],
    // scene-setting openers
    [`(?:在|於)(?:當今|當下|現今|如今|這個)${N}{0,12}?(?:時代|世界|社會|環境|浪潮)`, "在當今……時代", 1.4, "opener"],
    [`隨著${N}{1,20}?(?:快速|迅速|不斷|日益|蓬勃|飛速|持續)(?:的)?(?:發展|進步|普及|演進|成長|變化)`, "隨著……快速發展", 1.2, "opener"],
    [`在${N}{1,12}?的(?:浪潮|大潮|趨勢|背景)(?:下|中)`, "在……的浪潮下", 1.1, "opener"],
    // summarising closers
    ["總而言之|總的來說|綜上所述|總結來說|總結而言|簡而言之|總之[，,]", "總而言之", 1.2, "closer"],
    ["由此可見", "由此可見", 0.8, "closer"],
    ["希望(?:本文|這篇(?:文章)?|以上(?:內容)?)(?:能|可以|對)", "希望本文能", 1.3, "closer"],
    ["讓我們(?:一起|攜手|共同)?", "讓我們", 0.9, "closer"],
    ["未來可期|值得期待|拭目以待", "未來可期", 1.0, "closer"],
    ["唯有" + N + "{1,20}?(?:才能|方能)", "唯有……方能", 1.0, "closer"],
    // inflated vocabulary
    ["至關重要|不可或缺|不可忽視|不容忽視|舉足輕重|重中之重", "至關重要", 1.0, "buzzword"],
    ["深遠(?:的)?影響", "深遠影響", 0.8, "buzzword"],
    ["全方位|多維度|一站式|全鏈路|閉環", "全方位／一站式", 0.8, "buzzword"],
    ["賦能|助力|抓手|生態(?:系|圈)|痛點", "賦能／助力", 0.7, "buzzword"],
    ["無縫(?:接軌|整合|銜接)", "無縫整合", 1.0, "buzzword"],
    [`釋放${N}{0,6}?(?:潛力|價值|潛能)`, "釋放潛力", 1.0, "buzzword"],
    [`開啟${N}{0,6}?(?:新篇章|新紀元|新時代|新的篇章)`, "開啟新篇章", 1.2, "buzzword"],
    ["雙刃劍", "雙刃劍", 1.0, "buzzword"],
    ["挑戰與機遇|機遇與挑戰|機會與挑戰|挑戰與機會", "挑戰與機遇", 1.1, "buzzword"],
    ["深入(?:探討|探索|剖析|了解|研究|分析)", "深入探討", 1.0, "buzzword"],
    ["(?:全面|深度)(?:解析|剖析|探討)", "全面解析", 0.9, "buzzword"],
    ["不可(?:多得|替代)|獨一無二|前所未有", "前所未有", 0.6, "buzzword"],
    // set constructions
    [`扮演(?:著)?${N}{0,10}?(?:重要|關鍵|核心|不可或缺)的?角色`, "扮演……重要角色", 1.1, "template"],
    [`(?:起到|發揮)(?:了|著)?${N}{0,8}?(?:重要|關鍵|積極|核心)(?:的)?作用`, "發揮……重要作用", 1.0, "template"],
    [`為${N}{1,15}?提供(?:了)?(?:有力|堅實|重要|強大|可靠)的?(?:支撐|保障|基礎|支持)`, "為……提供堅實基礎", 1.1, "template"],
    [`不僅${N}{1,30}?(?:更|還|也)(?:能|可以|是|為|讓|將|要)`, "不僅……更", 0.8, "template"],
    [`一方面${N}{1,40}?另一方面`, "一方面……另一方面", 0.7, "template"],
    [`兼具${N}{1,10}?與`, "兼具……與", 0.5, "template"],
    // the newer cadence: reframes, reveals and aphoristic endings. These are
    // what current models do once told to drop the stock phrases above.
    [`(?:不是|並非|從來不是|早已不是|不只是|不僅是|不單是|不只在)${N}{1,30}?[，,]?(?:而是|更是|更在|也在)`, "不是……而是", 1.2, "reframe"],
    ["(?:說明|指向|證明|反映)(?:了)?(?:同)?一件事", "說明一件事", 1.3, "reframe"],
    ["(?:背後|底下)[，,]?(?:反映|折射|體現)(?:的)?是", "背後反映的是", 1.2, "reframe"],
    ["說到底|整體而言|整體來看|歸根究柢|歸根結底", "說到底／整體而言", 1.0, "closer"],
    ["從「[^」\\n]{1,12}」(?:走向|變成|轉為|轉變為|蛻變為|進化為)「", "從「A」走向「B」", 1.4, "reframe"],
    ["一場關於", "一場關於……的", 1.2, "reframe"],
    ["(?:悄然|悄悄)(?:地)?(?:改寫|改變|成形|興起|崛起|轉變|亮起)", "悄然改寫", 1.0, "reframe"],
    ["這(?:也)?意味著", "這意味著", 0.6, "reframe"],
    ["提醒(?:了)?我們", "提醒我們", 0.8, "reframe"],
    ["關鍵(?:在於|不只在|不在)", "關鍵在於", 0.5, "reframe"],
    [`從${N}{2,30}?到${N}{2,30}?[，,]再到`, "從……到……再到", 0.9, "reframe"],
    ["(?:必須|需要|值得)正視的(?:課題|問題)|值得(?:觀察|深思|玩味)", "值得正視的課題", 0.7, "reframe"],
    // assistant voice
    ["希望(?:這|以上)(?:些)?(?:資訊|內容|回答|說明)?(?:能)?對(?:你|您)(?:有)?(?:所)?幫助", "希望對你有幫助", 1.5, "assistant"],
    ["如果(?:你|您)(?:還)?有(?:任何|其他)(?:問題|疑問)", "如果您有任何問題", 1.5, "assistant"],
    ["^(?:當然|好的)[，！!,]", "當然！", 0.8, "assistant"],
  ];
  const MARKERS = ZH_PATTERNS.map(([src, label, weight, category]) => ({
    re: new RegExp(src, "gm"), label, weight, category,
  }));

  const RE_CJK = /[㐀-䶿一-鿿豈-﫿]/g;
  const RE_LATIN = /[A-Za-z]/g;
  const RE_SENT_SPLIT = /[。！？!?\n]+/;
  const RE_CLOSER_START = /^(?:總而言之|總的來說|綜上所述|總結來說|總結而言|簡而言之|總之|由此可見|未來)/;
  const MIN_CJK = 120;  // below this the density is noise

  function count(re, s) { return (s.match(re) || []).length; }

  function cjkRatio(text) {
    const c = count(RE_CJK, text);
    const l = count(RE_LATIN, text);
    return { cjk: c, latin: l, ratio: c + l ? c / (c + l) : 0 };
  }

  /** True when the text is mostly Chinese and this module (not the English one) should judge it. */
  function applies(text) {
    const r = cjkRatio(String(text || ""));
    return r.cjk >= 20 && r.ratio >= 0.3;
  }

  function sentenceStats(folded) {
    const lens = folded.split(RE_SENT_SPLIT).map((s) => count(RE_CJK, s) + count(RE_LATIN, s)).filter((n) => n > 0);
    if (lens.length < 2) return { sentences: lens.length, mean: lens[0] || 0, cv: null };
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) * (b - mean), 0) / lens.length);
    return { sentences: lens.length, mean: Math.round(mean * 10) / 10, cv: mean ? Math.round((sd / mean) * 1000) / 1000 : null };
  }

  function structure(folded) {
    const out = [];
    if (/首先/.test(folded) && /(?:其次|再者|接著|第二)/.test(folded) && /(?:最後|最終|第三)/.test(folded)) {
      out.push({ label: "首先／其次／最後", weight: 1.5, category: "structure" });
    }
    const paras = folded.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean);
    if (paras.length >= 2 && RE_CLOSER_START.test(paras[paras.length - 1])) {
      out.push({ label: "結尾總結段", weight: 1.0, category: "structure" });
    }
    const dashes = count(/——|—/g, folded);
    if (dashes >= 2) out.push({ label: `破折號 ×${dashes}`, weight: Math.min(dashes, 6) * 0.3, category: "structure" });
    const bold = count(/\*\*[^*\n]{1,40}\*\*/g, folded);
    if (bold >= 2) out.push({ label: `粗體標題 ×${bold}`, weight: 0.8, category: "structure" });
    return out;
  }

  function tierOf(score) { return score < 0.35 ? "low" : score < 0.65 ? "medium" : "high"; }

  /**
   * score(text) -> {
   *   status: "ok" | "insufficient_length" | "not_applicable",
   *   score: 0..1 | null, tier, density (weighted hits per 1000 CJK chars),
   *   cjk_chars, sentence_count, sentence_cv,
   *   matched: [{label, category, weight, count, examples:[original substrings]}],
   *   structure: [{label, category, weight}],
   *   spans: [{start, end, label, category}]   // UTF-16 offsets into the input
   * }
   */
  function score(text) {
    text = String(text || "");
    const r = cjkRatio(text);
    const base = { cjk_chars: r.cjk, cjk_ratio: Math.round(r.ratio * 1000) / 1000 };
    if (!(r.cjk >= 20 && r.ratio >= 0.3)) {
      return { ...base, status: "not_applicable", score: null, tier: null, density: null, matched: [], structure: [], spans: [] };
    }
    const folded = fold(text);
    const spans = [];
    const matched = [];
    for (const m of MARKERS) {
      m.re.lastIndex = 0;
      let n = 0;
      const examples = [];
      for (const hit of folded.matchAll(m.re)) {
        n++;
        const start = hit.index, end = hit.index + hit[0].length;
        spans.push({ start, end, label: m.label, category: m.category });
        const ex = text.slice(start, end);
        if (examples.length < 3 && !examples.includes(ex)) examples.push(ex);
      }
      if (n) matched.push({ label: m.label, category: m.category, weight: m.weight, count: n, examples });
    }
    spans.sort((a, b) => a.start - b.start || b.end - a.end);
    const struct = structure(folded);
    const sent = sentenceStats(folded);
    if (sent.sentences >= 8 && sent.cv != null && sent.cv < 0.35) {
      struct.push({ label: `句長均一 cv=${sent.cv}`, weight: 1.0, category: "structure" });
    }
    const raw = matched.reduce((a, m) => a + m.weight * m.count, 0) + struct.reduce((a, s) => a + s.weight, 0);
    const out = {
      ...base, sentence_count: sent.sentences, sentence_cv: sent.cv,
      matched, structure: struct, spans,
    };
    if (r.cjk < MIN_CJK) return { ...out, status: "insufficient_length", score: null, tier: "uncalibrated", density: null };
    // Divide by at least 500 characters: on a 150-character paragraph one
    // structural hit (say uniform sentence length) would otherwise clear the
    // threshold by itself. Measured on 49 human excerpts of 150 to 300
    // characters: 1 false positive (max 0.53) without the floor, 0 (max 0.22)
    // with it; full-length documents score the same either way.
    const density = raw / (Math.max(r.cjk, 500) / 1000);
    const s = 1 - Math.exp(-density / DENSITY_SCALE);
    const rounded = Math.round(s * 10000) / 10000;
    return { ...out, status: "ok", score: rounded, tier: tierOf(rounded), density: Math.round(density * 100) / 100 };
  }
  // density at which the score reaches 1 - 1/e (0.63). Set from the corpus run
  // described in README.md, section "Chinese AI-cadence heuristic (zh-style)";
  // change both together.
  const DENSITY_SCALE = 8;
  const DEFAULT_THRESHOLD = 0.35;

  /** Distinct original substrings that matched, most heavily weighted first: what a second rewrite pass should target. */
  function residualPhrases(rep, limit) {
    const seen = new Set();
    const out = [];
    const items = (rep.matched || []).slice().sort((a, b) => b.weight * b.count - a.weight * a.count);
    for (const m of items) for (const ex of m.examples) if (!seen.has(ex)) { seen.add(ex); out.push(ex); }
    return out.slice(0, limit || 20);
  }

  /** The whole sentences that still carry a hit, in reading order. A second rewrite pass
   * does better when told which sentence to fix than when handed a fragment. */
  function residualSentences(text, rep, limit) {
    text = String(text || "");
    const out = [];
    let lastEnd = -1;
    for (const sp of rep.spans || []) {
      if (sp.start < lastEnd) continue;
      let a = sp.start, b = sp.end;
      while (a > 0 && !/[。！？!?\n]/.test(text[a - 1])) a--;
      while (b < text.length && !/[。！？!?\n]/.test(text[b])) b++;
      if (b < text.length && /[。！？!?]/.test(text[b])) b++;
      out.push(text.slice(a, b).trim());
      lastEnd = b;
    }
    return out.slice(0, limit || 12);
  }

  const api = { score, applies, fold, residualPhrases, residualSentences, ZH_PATTERNS, DEFAULT_THRESHOLD };
  root.ZhStyle = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
