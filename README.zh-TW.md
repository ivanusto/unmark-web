# Unmark（`unmark-web`）

[English](README.md) · [繁體中文](README.zh-TW.md)

> 2026 年 8 月應上游維護者要求，自 `watermarks-remover-web` 改名，以免被誤認為官方元件。GitHub 會將舊的 repository 網址重新導向；線上示範已改到下方網址。

**移除 AI 工具留在生成內容上的數位浮水印與來源標記**：藏在文字裡看不見的 Unicode 字元，以及圖片、音訊、影片檔案裡的 C2PA、EXIF、XMP、ID3 中繼資料。
它也會照實告訴你哪些浮水印移除不了：統計式浮水印藏在 token 的取樣方式裡，像素域浮水印藏在影像本身，清中繼資料碰不到它們。「檢測器」分頁會分別檢測這些。

**[guillaumemeyer/watermarks-remover](https://github.com/guillaumemeyer/watermarks-remover)** 的獨立瀏覽器優先網頁客戶端，靈感來自該專案，並相容於它的 HTTP API。與上游專案無隸屬關係。

- **完全在瀏覽器中執行**：文字（Layer A：隱形 Unicode／同形字空白）與 PNG／JPEG／WebP／AVIF／HEIC／BMP／GIF／TIFF 中繼資料（C2PA、EXIF、XMP、文字區塊）皆是。不上傳、不做分析追蹤、不載入網頁字型、不發送任何第三方請求。
- **可選擇驅動上游的 Python 服務**（`server.py`）處理其餘格式，PDF、DOCX、ODT、EPUB、完整的 HTML／SVG／Markdown 容器清理，以及像素域後端。
- JavaScript 引擎是上游 **`text_unicode.py`、`image_meta.py`、`score_stylometry.py` 與 `detect_gumbel.py` 的逐行移植**，並有一套 parity 測試驗證輸出完全一致（保留／移除的字元相同，圖片解析器輸出的位元組相同，文風統計的數字相同，keyed-Gumbel 的 p 值也相同）。
- **「檢測器」分頁**是一個偵測實驗室：對同一份輸入跑過每一個偵測器並分別回報，字元層、中繼資料層、統計層，還能在 Layer A 清理後重新檢測，讓你看清楚清理器*沒有*動到哪一層。Keyed-Gumbel（EXP）偵測直接在頁面裡跑；其餘統計型偵測器（Kirchenbauer、SynthID-Text）透過選用的本機 sidecar 執行。

線上示範：[https://ivanusto.github.io/unmark-web/](https://ivanusto.github.io/unmark-web/) · 本機執行：直接開啟 `index.html`，或執行 `python3 serve_local.py`。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png">
  <img alt="在瀏覽器中執行的「文字」分頁：左側是貼上的原文，右側是清洗後的版本，中間的「檢測結果」列出被移除的軟連字號、零寬字元與零寬不斷行空格，以及被正規化的全形空格；下方是選用的 AI 改寫面板，已啟用但尚未執行。" src="docs/screenshot-light.png">
</picture>

## 功能範圍（與不做的事）

| 輸入 | 瀏覽器引擎 | 伺服器引擎（`server.py`） |
| --- | --- | --- |
| 貼上的文字 / `.txt` | Layer A：零寬與 bidi 控制字元、變體選擇符、tag 字元、PUA、Unicode 非字元、保留的預設可忽略字元、其他 `Cf`；空白同形字；可選的 NFKC／拉丁易混字元處理。與上游一致地保留具功能性的隱形字元（emoji 的 ZWJ/VS16、波斯文／印度系文字的 ZWNJ、旗幟 tag、蒙古文 FVS、高棉文母音、諺文填充字元、阿拉伯文 `Cf`，以及緊鄰自身書寫系統的排版控制字元：埃及聖書體象限、Duployan 速記、音樂符號連桿），並提供「偏執模式」開關。 | 同左 |
| `.md` `.html` `.svg` | 僅對文字內容套用 Layer A（中繼資料標籤／frontmatter 不動，UI 會標示） | 完整容器清理（frontmatter 鍵、`<meta generator>`、XMP……） |
| PNG / JPEG / WebP / AVIF / HEIC | 移除 `tEXt/zTXt/iTXt/eXIf/caBX/c2*` 區塊、`APPn`（JFIF 除外）與 `COM` 區段、`EXIF/XMP/ICCP/C2PA` RIFF 區塊並修正 VP8X 旗標，以及 ISOBMFF 的 `jumb/c2pa/uuid`（XMP）盒與其 `meta` 子盒。像素不動（不經 canvas 重新編碼）。「保留非 AI 中繼資料」模式只移除帶有 AI／C2PA 跡象的區塊。 | 同左，若有安裝則額外提供像素域後端 |
| BMP / GIF / TIFF | BMP：移除像素資料之後的尾端位元組（BMP 中繼資料唯一可能存在的位置）並改寫檔案大小欄位。GIF：移除註解與 XMP／未知的 application extension，保留 NETSCAPE2.0 循環與 ICC。TIFF（classic 與 BigTIFF）：走訪 IFD 鏈並移除 XMP／EXIF／GPS／IPTC／Photoshop／MakerNote 標籤，逐一原地修補 IFD，讓 strip 與 tile 的 offset 保持有效。 | 同左 |
| PDF / DOCX / ODT / EPUB | 不支援（需要伺服器） | 支援 |
| MP4／MOV／M4A／M4V／WAV／MP3／FLAC | 移除 MP4 與 AVIF／HEIC 共用的 `jumb`／`c2pa`／`uuid`（XMP）ISOBMFF 盒，以及 `moov/udta` 的生成器標籤；WAV 的 `C2PA`、`LIST INFO`、`id3 ` chunk；MP3 的 ID3v2 frame；FLAC 裡 C2PA 的 `GEOB application/c2pa` frame。取樣與影格完全不動。透過 `File.slice()` 讀取，長片與短片耗用的記憶體一樣多。 | 同上 |
| 統計式文字浮水印（Kirchenbauer／KGW、SynthID-Text） | **只偵測**，透過選用的本機 [sidecar](sidecar/README.md)（需要模型與生成端的 key）；不移除，改寫請見上游 Layer B | 伺服器宣告文字偵測器時走上游 `/detect`（MarkLLM harness） |
| 像素式浮水印（SynthID image 等） | **不支援** | 僅能透過上游後端 |

容器處理有三個常讓人意外的結果：

* **清理後的 AVIF／HEIC 檔案大小不變。** 被移除的 ISOBMFF 盒是就地覆寫成等長的 `free` 盒，
  而不是抽掉。抽掉會讓檔案後段所有絕對 offset 位移，圖就壞了。中繼資料確實已經消失：
  `free` 盒的內容是全零。
* **被截斷的檔案會保留截斷的尾段。** 下載中斷時，最後一個 PNG chunk 或 ISOBMFF 盒宣告的
  長度會超出檔案實際內容。那段尾巴會原樣保留並列進動作清單，避免把一個還救得回來的圖
  變成打不開的空殼，還宣稱它本來就是乾淨的。
* **音訊與影片不會進到記憶體。** 清理分頁只透過 `File.slice()` 讀 box 與 chunk 的標頭，
  交給瀏覽器的是由原檔切片組成的 `Blob`，因此幾 GB 的錄影也能在不持有整個檔案的情況下
  清理，只有中繼資料那幾段會被讀進來。檢測器分頁仍然整份讀入，維持 64 MiB 上限。

## 連接伺服器

`server.py` 綁定在 `127.0.0.1:8765`、**不送出 CORS 標頭**，且可能需要 bearer token，這是刻意的設計。從這個 UI 使用它有三種方式：

1. **`serve_local.py`（推薦）**，純標準函式庫、只綁 loopback 的靜態伺服器，會把 `/api/*` 代理到 `server.py`，讓瀏覽器以同源方式溝通：
   ```bash
   # 終端機 1：上游服務
   python3 service/scripts/server.py                     # 於上游 checkout 目錄下執行（或使用其 Docker image）
   # 終端機 2：本 UI
   python3 serve_local.py --upstream http://127.0.0.1:8765 [--api-key "$WATERMARKS_SERVER_API_KEY"]
   # 開啟 http://127.0.0.1:8766/  → UI 會自動選用 /api
   ```
2. **任何 reverse proxy**：只要它能服務這個目錄，並把某個路徑轉發到 `server.py`；接著在 ⚙️ *伺服器連線* 中填入該路徑（例如 `/api`）或 URL。
3. **直接填 URL**（例如從 GitHub Pages 版本使用）：只有在伺服器前方有東西以 CORS 允許本頁的來源時才會成功。上游刻意在 `server.py` 中**不**提供 CORS 支援（該 API 的定位是伺服器對伺服器；參見 [issue #77](https://github.com/guillaumemeyer/watermarks-remover/issues/77) 與 [PR #78](https://github.com/guillaumemeyer/watermarks-remover/pull/78)），因此這代表你得自行在它前面架 reverse proxy。請**不要**在該 API 上掛萬用字元的 CORS 標頭。

API 金鑰只會以 `Authorization: Bearer …` 送往你所設定的 URL，而且只有在勾選 *記住於此瀏覽器* 時才會存入 `localStorage`。

## AI 改寫（選用，僅限本機）

清洗只處理記號，不會動到文句本身。如果你還想把文字從 AI 的腔調裡改寫出來，`serve_local.py` 可以代理**你自己的 OpenAI 相容對話端點**，本機模型或任何你自架的服務都行：

```bash
# --llm-upstream  base URL，不含 /v1 後綴
# --llm-model     選填；用來預填模型欄位
# --llm-api-key   選填；只留在伺服器端
python3 serve_local.py \
  --llm-upstream http://<your-llm-host>:<port> \
  --llm-model <model-id> \
  --llm-api-key "$YOUR_KEY"

# 也可以用環境變數：UNMARK_LLM_URL / UNMARK_LLM_MODEL / UNMARK_LLM_API_KEY
```

清洗結果下方會出現「AI 改寫」面板，附一個可編輯的指示 prompt。它以**同源**方式送出 `POST /llm/v1/chat/completions`，所以金鑰不會進到瀏覽器，watermarks 服務自己的 bearer token 也不會被一起帶上。

有三件事要講明白：

- **預設關閉。** 沒有給 `--llm-upstream` 時，`/llm/*` 一律回 404，面板根本不會出現。
- **線上版做不到這件事。** [Demo 站](https://ivanusto.github.io/unmark-web/)是 HTTPS，而瀏覽器會擋掉 HTTPS 頁面呼叫純 HTTP 的本機端點。這是 `serve_local.py` 專屬的功能，並非疏漏。
- **清洗仍然離線，改寫則否。** 送去改寫的文字會離開這台裝置，抵達你設定的端點。「文字」與「檔案」分頁的處理則照舊留在頁面內，除非你另外連了伺服器。


## 檢測器（Watermark Inspector）

「檢測器」分頁是一個刻意與清理器分開的偵測實驗室。它對同一份輸入跑過每一個已註冊的偵測器，每個偵測器一列、依層分組：

| 層 | 偵測器 | 執行位置 | 命中的意義 |
| --- | --- | --- | --- |
| **字元層** | 隱形／格式 Unicode、雙向控制字元、同形字與特殊空白 | 瀏覽器（`js/layer_a.js`） | 確定性的，Layer A 能移除，重新檢測即可證明 |
| **中繼資料層** | C2PA／Content Credentials、XMP、EXIF／TIFF 標籤、AI 生成器標記、其他 | 瀏覽器（`js/image_meta.js`） | 容器裡存在來源或生成器中繼資料 |
| **統計層** | keyed-Gumbel／EXP、Kirchenbauer（KGW 綠名單）、SynthID-Text、上游 `/detect`、TextSeal（佔位）、文風統計（啟發式） | 瀏覽器（`js/gumbel.js`）／本機 sidecar／上游伺服器 | token 序列帶有**你所測試那把 key** 的取樣浮水印，僅此而已 |

每個偵測器都回傳同一種形狀，「複製 JSON 報告」匯出的就是它：

```json
{ "detector": "synthid-text", "layer": "statistical",
  "status": "detected | clean | uncertain | unavailable | not_tested | not_applicable | error",
  "confidence": 0.97, "score": 0.97, "threshold": 0.93,
  "evidence": [{ "label": "posterior", "detail": "0.9712" }],
  "note": null, "requires_key": true, "requires_model": true, "local": true, "heuristic": false,
  "meta": { "model": "Qwen/Qwen3-4B-Instruct-2507", "key_profile": "a", "tokens": 412 } }
```

UI 強制三條規則，因為誠實本身就是功能：

- **偵測器與清理器分離。**「以 Layer A 清理並重新檢測」只跑一次清理器，然後把每個偵測器的清理前／後並排，附「有變化？」欄。統計層的列若完全相同，總結會直說：*Layer A 清理沒有影響統計型浮水印偵測器。*
- **啟發式永遠不能說「偵測到」。** 文風統計（burstiness、MATTR、AI 片語密度，移植自上游 `score_stylometry.py`）上限是「不確定」，列上標示「啟發式」。
- **「不可用」不等於「乾淨」。** 多數統計型偵測器需要生成端的 key、tokenizer 與模型。在線上的 HTTPS 頁面它們回報「不可用」，總結寫的是*這裡沒有測試統計型浮水印，無法排除*。回報「乾淨」同樣只限於你測的那把 key 與那個方案。

### 瀏覽器裡的 Keyed-Gumbel（EXP）

唯一不需要 sidecar、不需要模型權重、也不需要連外的統計型偵測器：把上游的 `detect_gumbel.py` 移植成 [`js/gumbel.js`](js/gumbel.js)，並自帶 SHA-256 與 HMAC，因此它是同步的，用 `file://` 開檔或在線上版都能跑。在 Inspector 分頁展開 **Keyed-Gumbel（EXP）金鑰**，貼上這段文字生成時所用的金鑰（一段通關語，或以 `0x` 開頭的原始位元組）。金鑰只在這次執行期間存在於頁面裡：不會被儲存、不會送到任何地方，也不會寫進 JSON 報告。

它的原理是只憑文字重放取樣器的雜訊。每個位置算出 `seed = HMAC(key, 前 H 個 token)` 與 `u = HMAC(seed, token)`，把 `-log(1 - u)` 累加起來，再拿去和「沒有浮水印時應該服從的 `Gamma(counted, 1)` 分佈」比對。重複出現的脈絡視窗會跳過，因為生成端遇到視窗重複時就退回一般隨機取樣。

結果要照上游的原意讀：

- 這是**同金鑰重放**。只對生成時所用的金鑰、tokenizer 與 PRF 佈局有效，實務上代表你自己掌控的自架引擎。
- **負面結果什麼都不能證明。** 沒有浮水印的文字、別人金鑰生成的文字、人寫的文字，三者都落在隨機水準上，所以那一列的意思是「不是這把金鑰」，不是「沒有浮水印」。
- PRF 佈局是該方案的 **clean-room 實作**（HMAC-SHA256 套在打包後的 token id 上），可稽核，但與任何特定引擎的 kernel 並非位元相容。要對真實引擎精確重放，得用那個引擎的 tokenizer 與 PRF。

脈絡視窗預設 4 個 token，判定門檻預設 `p < 1e-6`，兩者都能在金鑰欄位旁邊調整。分數欄顯示的是 `-log10(p)` 對 `-log10(門檻)`，數字越大證據越強，確切的 p 值是證據清單的第一列。

### 統計層 sidecar（選用，僅限本機）

[`sidecar/unmark_stat.py`](sidecar/README.md) 是一支小型 Python 服務（PyTorch＋🤗 Transformers，建議有 GPU），用 `transformers` 內建的參考 Kirchenbauer 與 SynthID-Text 偵測器打分，採用**公開的實驗 key** 與 [`xlr8harder/synthid`](https://github.com/xlr8harder/synthid)（MIT）針對 `Qwen/Qwen3-4B-Instruct-2507` 獨立訓練的 SynthID Bayesian 偵測器。它也能用指定的 key *生成*帶浮水印的樣本，讓整個示範走得通：

```bash
# 終端機 1：sidecar（第一次執行會下載模型與偵測器）
python -m venv sidecar/.venv && sidecar/.venv/bin/pip install -r sidecar/requirements.txt
sidecar/.venv/bin/python sidecar/unmark_stat.py            # 127.0.0.1:8767

# 終端機 2：本 UI，把 /stat/* 代理過去
python3 serve_local.py --stat-upstream http://127.0.0.1:8767
```

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-inspector-dark.png">
  <img alt="檢測器分頁在「以 Layer A 清理並重新檢測」一段 SynthID 浮水印樣本之後：字元層從 30 個零寬空格變為乾淨，Kirchenbauer 維持乾淨、SynthID-Text 維持偵測到且判定相同；總結寫著 Layer A 清理沒有改變任何統計型判定。" src="docs/screenshot-inspector-light.png">
</picture>

接著在檢測器分頁：用 SynthID-Text、key **A** 生成 → 以 key A 檢測（偵測到）→ 切到 key **B**（乾淨／不確定）→「以 Layer A 清理並重新檢測」（分數不變）。兩個世界：字元層歸零，統計層紋風不動。

限制直說：偵測只對**同一方案、同一把 key、同一個 tokenizer** 有效；你手上沒有 key 的模型產生的文字無法判定，sidecar 回的是「對這把 key 而言乾淨」，而不是「沒有浮水印」。它跟改寫面板一樣是 `serve_local.py` 的功能，線上頁面連不到純 HTTP 的 loopback 服務。

## 開發

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
git clone https://github.com/guillaumemeyer/watermarks-remover ../watermarks-remover     # parity 測試需要
WATERMARKS_UPSTREAM_DIR=../watermarks-remover .venv/bin/pytest -q
node scripts/check-upstream.mjs                                                          # 檢查上游雜湊漂移
```

本專案沒有 `package.json`，執行期與測試都不需要 npm，因此上游檢查直接用 `node` 執行，與 [workflow](.github/workflows/upstream-check.yml) 的呼叫方式完全一致。退出碼：`0` 表示雜湊仍相符、`1` 表示偵測到漂移、`2` 表示根本無法檢查（網路、速率限制、manifest 有問題）。抓不到來源絕不會被當成漂移回報。

- `js/layer_a.js`，`text_unicode.py` 的移植（`clean`、`inspect`、`decide`）
- `js/image_meta.js`，`image_meta.py` 的移植（PNG/JPEG/WebP/AVIF/HEIC/BMP/GIF/TIFF 檢查與清除）
- `js/stylometry.js`，`score_stylometry.py` 的移植（burstiness／MATTR／AI 片語密度；啟發式，不是浮水印偵測器）
- `js/gumbel.js`，`detect_gumbel.py` 的移植（keyed-Gumbel／EXP 同金鑰重放，自帶同步版 SHA-256 與 HMAC，因此不需要 `crypto.subtle`，也不需要 secure context）
- `js/detectors.js`，檢測器的偵測器註冊表：字元、中繼資料、統計三層共用一種結果契約，加上給總結與前後對照用的 `summarize()`／`compare()`
- `js/api.js`，`/health /capabilities /inspect /clean /detect` 的客戶端，以及選用的 `/llm-config`＋`/llm` 改寫呼叫與 `/stat-config`＋`/stat` sidecar 呼叫
- `js/i18n.js`、`js/app.js`、`css/app.css`、`index.html`，UI（英文／繁體中文／簡體中文、淺色／深色、支援鍵盤操作）。語系依 `navigator.languages` 判斷並記在 `localStorage`；新增語言只需在 `js/i18n.js` 的 `LANGS` 加一列、再加一本字典。
- `tests/test_layer_a_parity.py`、`tests/test_image_meta_parity.py`、`tests/test_stylometry_parity.py`、`tests/test_gumbel_parity.py`，與上游 checkout 的跨引擎 parity 測試（缺少 `node` 或該 checkout 時會跳過）
- `tests/test_i18n_keys.py`，三個語系必須有相同的字串鍵，且 `index.html` 裡每個 `data-i18n` 都解得開。這種缺口在執行期看不出來，因為 `t()` 會靜靜 fallback。
- `serve_local.py`，同源靜態伺服器 + `/api` 代理、選用的 `/llm` 改寫代理，以及選用的 `/stat` sidecar 代理
- `sidecar/`，統計型偵測器 sidecar（有自己的 `requirements.txt`；永遠不是頁面的一部分）
- `scripts/check-upstream.mjs`，以 `node scripts/check-upstream.mjs` 執行；以 `scripts/upstream-sources.json` 記錄的雜湊比對上游 Python 模組；`.github/workflows/upstream-check.yml` 每天執行它與 parity 測試，任一訊號觸發就開 issue。parity 抓行為改變，雜湊抓測試涵蓋不到的變動（例如上游新增了一種格式）。

沒有建置步驟，執行期零相依。CSP：`default-src 'self'; connect-src *`（後者是為了讓你能指向自己的伺服器）。

## 版本紀錄

各版完整說明見 [releases](https://github.com/ivanusto/unmark-web/releases)。

### [v0.4.2](https://github.com/ivanusto/unmark-web/releases/tag/v0.4.2)

- **介面終於說出它會處理音訊與影片**。自 v0.4.0 起引擎就會清理與檢測 MP4／MOV／M4A／M4V、MP3、WAV、FLAC，檔案選擇器也一直接受，但品牌副標、「檔案」分頁標籤、兩行拖放說明、檢測器的按鈕與空狀態、頁面 meta 描述全都還在描述一個只處理圖片的工具。三語系共九條字串，另加 `index.html` 裡兩處過時的英文行內備援。
- **修正一句比音影更早就錯的說法**。伺服器引擎說明寫著圖片仍在本機處理。實際上只要連上伺服器，丟進來的每個檔案都會送出去；只有貼在「文字」分頁的內容留在本機。

### [v0.4.1](https://github.com/ivanusto/unmark-web/releases/tag/v0.4.1)

- **截斷 MP4 的分歧結束了，上游採用了同一個修法**。[guillaumemeyer/watermarks-remover#242](https://github.com/guillaumemeyer/watermarks-remover/pull/242) 合併了本移植早就有的保留尾段寫法，因此 `tests/test_av_meta_parity.py` 現在斷言兩邊一致，而不是斷言兩邊不同。#242 另外加了一個 `inspection_incomplete` 旗標，`clean_av` 會把它併進 `still_has_ai_metadata`；`cleanAv` 與 `cleanAvFile` 以 `inspectionIncomplete` 帶著它，截斷的檔案會被回報為無法確認，而不是乾淨。
- 新的 parity 錨點：`av_meta.py` `579b01cbac34`。

### [v0.4.0](https://github.com/ivanusto/unmark-web/releases/tag/v0.4.0)

- **音訊與影片**（`js/av_meta.js`，移植自上游 `av_meta.py`）：MP4／MOV／M4A／M4V、WAV、MP3、FLAC，全部在瀏覽器裡完成。MP4 直接重用支撐 AVIF／HEIC 的那套 ISOBMFF box walker。
- **清理影片不等於得把它整個抱著**。引擎在同一組原語上提供兩個 driver：整檔緩衝那個由 parity 測試對上游把關，切片 driver 則透過 `File.slice()` 走標頭、回傳由原檔切片組成的 `Blob`。128 MB 的 MP4 只讀 0.32 KB，輸出逐位元相同。64 MiB 的瀏覽器上限對音訊與影片不再適用。
- **截斷的 MP4 會保住媒體**。上游的 `_strip_moov_udta` 從解析成功的 box 重建檔案、把其餘丟掉，動作清單卻寫著保留了尾段；本移植保留它，就像上游 #182 對 PNG 與 ISOBMFF 已經確立的做法。已報 [guillaumemeyer/watermarks-remover#240](https://github.com/guillaumemeyer/watermarks-remover/issues/240)，在它合併之前記錄於 `scripts/upstream-sources.json`。
- 檢測器分頁透過同一組中繼資料偵測器回報音訊與影片的發現，並且會拒絕超過自身上限的檔案，而不是照讀不誤。
- 新的 parity 錨點：`av_meta.py` `992981922d27`。

### [v0.3.1](https://github.com/ivanusto/unmark-web/releases/tag/v0.3.1)

- **另外五個字元後面的 emoji 呈現選擇器**（上游 #200）：`U+203C`、`U+2049`、`U+2139`、`U+2934`、`U+2935` 的 Emoji 屬性為是，但落在原本判斷式涵蓋的區塊範圍之外，因此它們後面的 VS16 會被移除，emoji 就退回文字字形。
- **保留非 AI 中繼資料時，良性的 JPEG 註解會留下**（上游 #216）：`COM` 區段是沒有鍵名的自由文字，所以現在只有在開啟*移除全部中繼資料*、或註解確實帶有來源標記時才移除。`Generated by ImageMagick` 與 `Claude Monet` 是註解文句，不是證據。
- **JPEG 的整檔 C2PA 位元組掃描收窄**（同一項變更）：`jumb` 與 XMP 的 InstanceID 命名空間在一般檔案裡本來就會出現，因此它們單獨出現不再讓一張 JPEG 被判定為 C2PA；出現在已解析的 APP 區段裡則仍然算數。
- **標記掃描不再把整個檔案組成字串**：`containsAny` 改為在首位元組分派表後面直接掃位元組。以 24 MB 的 HEIC 實測，應用程式那一輪 inspect、clean、再 inspect 從 2936 毫秒降到 121 毫秒，輸出完全相同。`tests/test_contains_any_parity.py` 把它釘在上游的 `_contains_any` 上。
- Parity 錨點更新為 `text_unicode.py` `ed86ed9715f4` 與 `image_meta.py` `3bde868717f5`。

### [v0.3.0](https://github.com/ivanusto/unmark-web/releases/tag/v0.3.0)

- **瀏覽器端的 Keyed-Gumbel（EXP）偵測**（`js/gumbel.js`，移植自上游 `detect_gumbel.py`）。第一個不需要 sidecar、不需要模型權重、也不需要連外的統計型偵測器，所以線上版也能得出判定。它是同金鑰重放：判定為「乾淨」的意思是*不是這把金鑰*，不是*沒有浮水印*。
- **Layer A 強化**（上游 #133）：`U+180F`、`U+3164`、`U+FFA0` 緊鄰自身書寫系統時保留、漂浮時移除；Unicode 非字元與保留的預設可忽略字元改為移除類；緊鄰自身書寫系統的排版控制字元（埃及聖書體象限、Duployan 速記、音樂符號連桿）予以保留。
- **圖片容器**（上游 #176、#182、#183）：被移除的 ISOBMFF 盒改成就地覆寫為等長的 `free` 盒，因此清理後的 AVIF／HEIC 大小不變，檔案後段的媒體 offset 也仍然有效；被截斷的 PNG chunk 或 ISOBMFF 盒會保留尾段，不再一邊丟掉一邊宣稱檔案本來就是乾淨的。
- Parity 錨點更新為 `text_unicode.py` `ab0197b06263`、`image_meta.py` `78e5a67db243`，以及新增的 `detect_gumbel.py` `f908272084cd`。

### [v0.2.0](https://github.com/ivanusto/unmark-web/releases/tag/v0.2.0)

- **檢測器（Watermark Inspector）**：第三個分頁，對同一份輸入跑過每個偵測器並分別回報，涵蓋字元、中繼資料、統計三層，共用同一種結果契約（`js/detectors.js`）。
- **文風統計**（`js/stylometry.js`，移植自 `score_stylometry.py`），上限是「不確定」，因為啟發式不是浮水印偵測器。
- **統計層 sidecar**（`sidecar/unmark_stat.py`）：以 `transformers` 內建的參考偵測器做 Kirchenbauer／KGW 與 SynthID-Text 偵測，由 `serve_local.py --stat-upstream` 同源代理。僅限本機，預設關閉。

### [v0.1.0](https://github.com/ivanusto/unmark-web/releases/tag/v0.1.0)

首個版本。瀏覽器端的 Layer A 文字清理與圖片容器清理、三個語系、`serve_local.py` 後面選用的本機 AI 改寫，以及把兩支引擎釘在上游的 parity 測試。

## 致謝與授權

MIT，見 [LICENSE](LICENSE)。字元表、判斷規則與容器解析器衍生自 watermarks-remover，© watermarks-remover contributors，MIT；上游聲明保留於 [NOTICE](NOTICE)。請僅用於你擁有或已獲授權修改的內容，參見上游的[倫理說明](https://github.com/guillaumemeyer/watermarks-remover/blob/main/skills/remove-ai-marks/references/ethics.md)。
