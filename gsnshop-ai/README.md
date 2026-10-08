# GSN AI 推論服務 UI 原型

這是 gsnshop.amaryllo.us 擴充的 AI token 銷售介面原型，參考 fireworks.ai 的產品結構。

- `index.html`：單一檔案、免建置的前端原型。直接用瀏覽器開啟即可。
- `MODEL_PRICING_PLAN.md`：2× H100 + 1× RTX 5090 的模型配置、模型與機器適用表、價格、儲值方案與損益估算。

## 頁面

| 路由 | 內容 |
|---|---|
| `#home` | 首頁：主視覺、叢集 GPU 記憶體配置、精選模型、OpenAI 相容範例程式碼 |
| `#models` | 模型庫：H100 / RTX 5090 機器規格、依類型或機器篩選、每個模型標示適用機器 |
| `#playground` | 對話測試、參數調整、每則回覆顯示 token 數與費用 |
| `#pricing` | 價格表、儲值方案、費用試算、速率等級 |
| `#dashboard` | 控制台：餘額與用量圖、API 金鑰管理、儲值與帳單、用量紀錄 |
| `#docs` | 快速開始、端點、錯誤碼 |

## 目前是模擬的部分

- Playground 回覆、用量資料、GPU 狀態都是示範資料。
- 儲值不會真的扣款；餘額與 API 金鑰存在瀏覽器 localStorage。
- API Base URL `https://api.gsnshop.amaryllo.us/v1` 是預留的網址，需要依實際部署調整。

## 換成 gsnshop 的品牌風格

所有顏色與字體都定義在 `index.html` 最上方的 `:root` 變數。改 `--accent`、`--font-*` 等 token 即可套用現有網站的色系，
或把 `<header>` 換成 gsnshop 現有的導覽列。

## 接上後端

建議架構：`瀏覽器 → API Gateway（金鑰驗證、速率限制、計費） → vLLM / TEI / faster-whisper`。
前端需要的 API：

- `GET /me`：帳號、等級、餘額
- `GET/POST/DELETE /keys`：API 金鑰
- `GET /usage?from=&to=&group_by=model|key`：用量
- `POST /billing/checkout`：建立金流訂單（綠界 / 藍新），回呼後入帳
- `GET /cluster/status`：GPU 使用率（由 DCGM Exporter 提供）
