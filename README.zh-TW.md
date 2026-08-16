# watermarks-remover-web

[English](README.md) · [繁體中文](README.zh-TW.md)

**[guillaumemeyer/watermarks-remover](https://github.com/guillaumemeyer/watermarks-remover)** 的獨立瀏覽器優先網頁客戶端 —— 靈感來自該專案，並相容於它的 HTTP API。與上游專案無隸屬關係。

- **完全在瀏覽器中執行**：文字（Layer A：隱形 Unicode／同形字空白）與 PNG／JPEG／WebP／AVIF／HEIC 中繼資料（C2PA、EXIF、XMP、文字區塊）皆是。不上傳、不做分析追蹤、不載入網頁字型、不發送任何第三方請求。
- **可選擇驅動上游的 Python 服務**（`server.py`）處理其餘格式 —— PDF、DOCX、ODT、完整的 HTML／SVG／Markdown 容器清理，以及像素域後端。
- JavaScript 引擎是上游 **`text_unicode.py` 與 `image_meta.py` 的逐行移植**，並有一套 parity 測試驗證輸出完全一致（保留／移除的字元相同，圖片解析器輸出的位元組也相同）。

線上示範：[https://ivanusto.github.io/watermarks-remover-web/](https://ivanusto.github.io/watermarks-remover-web/) · 本機執行：直接開啟 `index.html`，或執行 `python3 serve_local.py`。

## 功能範圍（與不做的事）

| 輸入 | 瀏覽器引擎 | 伺服器引擎（`server.py`） |
| --- | --- | --- |
| 貼上的文字 / `.txt` | Layer A：零寬與 bidi 控制字元、變體選擇符、tag 字元、PUA、其他 `Cf`；空白同形字；可選的 NFKC／拉丁易混字元處理。與上游一致地保留具功能性的隱形字元（emoji 的 ZWJ/VS16、波斯文／印度系文字的 ZWNJ、旗幟 tag、蒙古文 FVS、高棉文母音、諺文填充字元、阿拉伯文 `Cf`），並提供「偏執模式」開關。 | 同左 |
| `.md` `.html` `.svg` | 僅對文字內容套用 Layer A（中繼資料標籤／frontmatter 不動 —— UI 會標示） | 完整容器清理（frontmatter 鍵、`<meta generator>`、XMP……） |
| PNG / JPEG / WebP / AVIF / HEIC | 移除 `tEXt/zTXt/iTXt/eXIf/caBX/c2*` 區塊、`APPn`（JFIF 除外）與 `COM` 區段、`EXIF/XMP/ICCP/C2PA` RIFF 區塊並修正 VP8X 旗標，以及 ISOBMFF 的 `jumb/c2pa/uuid`（XMP）盒與其 `meta` 子盒。像素不動（不經 canvas 重新編碼）。「保留非 AI 中繼資料」模式只移除帶有 AI／C2PA 跡象的區塊。 | 同左，若有安裝則額外提供像素域後端 |
| PDF / DOCX / ODT | ——（需要伺服器） | 支援 |
| 統計式／像素式浮水印（SynthID 等） | **不支援** —— 兩者皆不在範圍內；請參考上游的 Layer B | 僅能透過上游後端 |

## 連接伺服器

`server.py` 綁定在 `127.0.0.1:8765`、**不送出 CORS 標頭**，且可能需要 bearer token —— 這是刻意的設計。從這個 UI 使用它有三種方式：

1. **`serve_local.py`（推薦）** —— 純標準函式庫、只綁 loopback 的靜態伺服器，會把 `/api/*` 代理到 `server.py`，讓瀏覽器以同源方式溝通：
   ```bash
   # 終端機 1：上游服務
   python3 service/scripts/server.py                     # 於上游 checkout 目錄下執行（或使用其 Docker image）
   # 終端機 2：本 UI
   python3 serve_local.py --upstream http://127.0.0.1:8765 [--api-key "$WATERMARKS_SERVER_API_KEY"]
   # 開啟 http://127.0.0.1:8766/  → UI 會自動選用 /api
   ```
2. **任何 reverse proxy**：只要它能服務這個目錄，並把某個路徑轉發到 `server.py`；接著在 ⚙️ *伺服器連線* 中填入該路徑（例如 `/api`）或 URL。
3. **直接填 URL**（例如從 GitHub Pages 版本使用）—— 只有在伺服器前方有東西以 CORS 允許本頁的來源時才會成功。上游刻意在 `server.py` 中**不**提供 CORS 支援（該 API 的定位是伺服器對伺服器；參見 [issue #77](https://github.com/guillaumemeyer/watermarks-remover/issues/77) 與 [PR #78](https://github.com/guillaumemeyer/watermarks-remover/pull/78)），因此這代表你得自行在它前面架 reverse proxy。請**不要**在該 API 上掛萬用字元的 CORS 標頭。

API 金鑰只會以 `Authorization: Bearer …` 送往你所設定的 URL，而且只有在勾選 *記住於此瀏覽器* 時才會存入 `localStorage`。

## 開發

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
git clone https://github.com/guillaumemeyer/watermarks-remover ../watermarks-remover     # parity 測試需要
WATERMARKS_UPSTREAM_DIR=../watermarks-remover .venv/bin/pytest -q
```

- `js/layer_a.js` —— `text_unicode.py` 的移植（`clean`、`inspect`、`decide`）
- `js/image_meta.js` —— `image_meta.py` 的移植（PNG/JPEG/WebP/AVIF/HEIC 檢查與清除）
- `js/api.js` —— `/health /capabilities /inspect /clean` 的客戶端
- `js/i18n.js`、`js/app.js`、`css/app.css`、`index.html` —— UI（英文／繁體中文／簡體中文、淺色／深色、支援鍵盤操作）。語系依 `navigator.languages` 判斷並記在 `localStorage`；新增語言只需在 `js/i18n.js` 的 `LANGS` 加一列、再加一本字典。
- `tests/test_layer_a_parity.py`、`tests/test_image_meta_parity.py` —— 與上游 checkout 的跨引擎 parity 測試（缺少 `node` 或該 checkout 時會跳過）
- `serve_local.py` —— 同源靜態伺服器 + `/api` 代理

沒有建置步驟，執行期零相依。CSP：`default-src 'self'; connect-src *`（後者是為了讓你能指向自己的伺服器）。

## 致謝與授權

MIT —— 見 [LICENSE](LICENSE)。字元表、判斷規則與容器解析器衍生自 watermarks-remover，© watermarks-remover contributors，MIT；上游聲明保留於 [NOTICE](NOTICE)。請僅用於你擁有或已獲授權修改的內容 —— 參見上游的[倫理說明](https://github.com/guillaumemeyer/watermarks-remover/blob/main/skills/remove-ai-marks/references/ethics.md)。
