# GSN AI 推論服務 UI 原型

這是 gsnshop.amaryllo.us 擴充的 AI token 銷售介面原型，參考 fireworks.ai 的產品結構。

- `index.html`：單一檔案、免建置的前端原型。直接用瀏覽器開啟即可。
- `MODEL_PRICING_PLAN.md`：2× H100 + 1× RTX 5090 的模型配置、模型與機器適用表、價格、儲值方案與損益估算。

## 頁面與流程

介面沿用 gsnshop 現有的設計（深色主題、左側選單、表格＋購物車），AI 服務以「AI Inference」群組加在原有選單下方，與 Reserve Instances 共用同一個購物車。

| 路由 | 內容 |
|---|---|
| `#reserve` | Reserve Instances（現有頁面的重現，可加入購物車） |
| `#vms` | Access VMs（現有頁面的佔位） |
| `#orders` | Order Summary：主機與 AI Credits 訂單 |
| `#models` | AI Models：H100 / RTX 5090 機器規格、依類型或機器篩選、每個模型的適用機器與價格 |
| `#credits` | Buy Credits：儲值方案表，One-time / Monthly 切換，加入購物車 |
| `#cart` | Cart：數量調整、Summary、Continue → 付款；超過 $3,000 改走匯款 |
| `#playground` | 對話測試，每則回覆顯示 token 數、費用與服務機器 |
| `#keys` | API Keys：建立、撤銷、快速開始程式碼、端點列表 |
| `#usage` | Usage：餘額、14 天花費圖、請求紀錄 |

購買流程：Buy Credits → 購物車圖示 → Cart → Continue → 付款 → Order Summary（額度即時入帳）。
金額超過 $3,000 時，與現有網站相同，按 Continue 後建立待匯款訂單，由業務以 Email 提供匯款資訊。

## 目前是模擬的部分

- Playground 回覆、用量資料、GPU 狀態都是示範資料。
- 儲值不會真的扣款；餘額與 API 金鑰存在瀏覽器 localStorage。
- API Base URL `https://api.gsnshop.amaryllo.us/v1` 是預留的網址，需要依實際部署調整。

## 換成 gsnshop 的品牌風格

顏色與字體都定義在 `index.html` 最上方的 `:root` 變數，已依現有網站截圖調整。實際整合時可直接沿用 gsnshop 的頂部列與側邊欄元件，只需加入 AI Inference 群組的選單項目。

## 接上後端

建議架構：`瀏覽器 → API Gateway（金鑰驗證、速率限制、計費） → vLLM / TEI / faster-whisper`。
前端需要的 API：

- `GET /me`：帳號、等級、餘額
- `GET/POST/DELETE /keys`：API 金鑰
- `GET /usage?from=&to=&group_by=model|key`：用量
- `POST /billing/checkout`：建立金流訂單（綠界 / 藍新），回呼後入帳
- `GET /cluster/status`：GPU 使用率（由 DCGM Exporter 提供）
