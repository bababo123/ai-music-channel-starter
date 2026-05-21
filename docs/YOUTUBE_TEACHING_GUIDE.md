# AI 音樂頻道自動化專案：YouTube 教學重點版

這份內容適合拿來拍一支精簡版 YouTube 介紹影片。重點不是把每一步操作全部列出來，而是讓觀眾理解：這個專案串了哪些 API、用了哪些服務、怎麼做人工審查，以及如何定期追蹤頻道數據。

## 影片主軸

這個專案是一條半自動 AI 音樂頻道製作流程。它會協助我們產生一小時的 ambient / lofi focus music 影片，並把音樂、圖片、影片、縮圖、YouTube metadata、審核紀錄、上傳紀錄與頻道數據全部納入同一套系統管理。

可以用這句話開場：

> 這不是單純叫 AI 生一首歌，而是把一個 AI 音樂 YouTube 頻道，做成一套可以審核、可以上傳、可以追蹤數據的內容生產系統。

## 1. 串接了哪些 API

### MiniMax Music Generation API

用途是生成每一首 instrumental music track。專案會為一集影片規劃多首 track，呼叫 MiniMax 產生音樂，並把回傳的音訊立即下載到本機。

重點：

- 使用 `music-2.6` 類型的音樂生成模型。
- 以 instrumental、no vocal、no lyrics 為主要設定。
- 產生後立刻下載，避免 provider URL 過期。
- 把 prompt、provider response、duration、file path、hash 存進 SQLite。

教學時可以說：

> AI provider 回傳的 URL 不能當永久資料，所以我們一定要立刻下載，並把檔案與 metadata 存進自己的系統。

### OpenAI / Codex Image Workflow

專案原本有 OpenAI image provider，也實際採用 Codex 互動式圖片生成流程。圖片模型負責產生 hero image 和 thumbnail background，但最終縮圖文字不是交給 AI 生成，而是用程式疊上去。

重點：

- AI 產生背景圖，不產生文字。
- Sharp 負責裁切成 `1920x1080` hero image 與 `1280x720` thumbnail。
- Thumbnail 文字用程式疊上，避免 AI 拼錯字。

教學時可以說：

> 這裡的關鍵不是讓 AI 做全部，而是讓 AI 做它擅長的視覺氛圍，讓程式負責精準文字與版面。

### Notion API

Notion 是人工審核與營運 dashboard。SQLite 是 source of truth，Notion 則讓人更容易查看每一集的狀態、素材路徑、發布資訊與審核欄位。

重點：

- 同步 episode 狀態。
- 顯示 final video、thumbnail、publish package、preview audio。
- 提供人工審核與營運追蹤的工作台。

教學時可以說：

> 自動化不是把人移除，而是把人放在最重要的審核節點。

### YouTube Data API

YouTube Data API 負責後段發布與追蹤。專案使用 OAuth refresh token 進行 private upload，並支援設定 thumbnail、加入 playlist、查詢影片狀態與抓取 performance snapshot。

重點：

- 上傳影片預設是 private。
- 設定 custom thumbnail。
- 支援 playlist insertion。
- 使用 `videos.list` 查詢 status 與 statistics。
- 把 views、likes、comments 等快照存回 SQLite。

教學時可以說：

> 影片上傳不是這條 pipeline 的終點，後續的數據追蹤才是內容優化的起點。

## 2. 使用了哪些服務與工具

### TypeScript CLI

整個專案是 CLI-first。所有重要操作都包成 npm scripts，例如建立 episode、生成音樂、音訊 QC、混音、匯入圖片、產生 YouTube package、審核、上傳、追蹤數據。

代表價值：

- 每一步都可以單獨執行。
- 支援 dry run。
- 失敗後可以局部重跑。
- 適合未來接排程或自動化。

### SQLite

SQLite 是整個專案的資料核心。它保存 series、episodes、tracks、assets、QC results、review decisions、YouTube uploads、performance snapshots。

代表價值：

- 知道每一集做到哪個階段。
- 保存每一步生成的輸入與輸出。
- 可以中斷後恢復，不必從頭再來。
- 上傳與數據追蹤也有紀錄。

可以用這句話總結：

> SQLite 是這個 AI 內容流水線的記憶。

### FFmpeg / ffprobe

FFmpeg 是音訊與影片處理的核心工具。

使用場景：

- 用 `ffprobe` 檢查音訊 duration、sample rate、channels。
- 用 `volumedetect` 做基本音量 QC。
- 用 `acrossfade` 串接多首 tracks。
- 用 `loudnorm` 做音量標準化。
- 用 `zoompan`、`xfade`、`drawtext` 組出長影片。

代表價值：

- 不需要每次手動剪輯。
- 可以程式化輸出一小時影片。
- 可以先做 smoke test，再 render full video。

### Sharp

Sharp 負責圖片規格化與縮圖文字。

使用場景：

- resize / crop 圖片。
- 產生 hero image。
- 產生 thumbnail base。
- 疊上系列名稱與 subtitle。

代表價值：

- 縮圖文字穩定、可控、可重複。
- 避免 AI 生成文字錯誤。

### HyperFrames / HTML-based Video Composition

專案也有使用 HyperFrames 來處理 HTML-based video composition。它適合把圖片、文字、chapter overlay、GSAP 動畫和音訊組成影片。

代表價值：

- 用 HTML/CSS/JS 思維製作影片畫面。
- 適合做慢速 ambient video。
- 可以處理 title fade、chapter fade、背景 slow pan。

### Zod / Pino / Commander

這些是工程品質工具：

- Zod：驗證 env 和外部 API response。
- Pino：structured logging。
- Commander：CLI command parsing。

代表價值：

- API 不穩時能清楚知道錯在哪。
- CLI 更容易維護。
- log 可以追蹤 episode 和 track 的失敗位置。

## 3. 最終如何進行審查

這個專案不是生成完就直接上傳，而是採用 human-in-the-loop approval。

審查流程的核心是 YouTube publish package。

### Publish Package 內容

每一集在上傳前會產生一份 package，裡面包含：

- final video path
- thumbnail path
- final audio path
- 60 秒 preview audio
- YouTube title
- description
- chapters
- tags
- hashtags
- pinned comment
- upload checklist

這份 package 同時輸出成 Markdown 和 JSON。Markdown 給人看，JSON 給 upload command 讀。

### 人工審查重點

審查者主要看：

- final MP4 是否能正常播放。
- 前 30 秒是否適合 YouTube 開場。
- 15、30、50 分鐘附近是否有刺耳或突兀聲音。
- 縮圖文字是否正確。
- title、description、chapters 是否合理。
- 是否已標示 AI-assisted / synthetic content。
- 是否應該 private upload。

### Approval Gate

只有人工 approval 後，系統才允許 upload。

approval 會寫入 SQLite 的 `review_decisions`，包含：

- episode id
- decision
- reviewer
- notes
- created_at

如果沒有 approval，`youtube:upload` 會被擋下來。

教學時可以說：

> AI 生成內容可以自動化，但發布決策不應該完全自動化。這個 approval gate 是整條 pipeline 最重要的安全設計。

## 4. 如何定期追蹤頻道數據

專案上傳影片後，會把 YouTube 表現資料定期抓回來，存到 SQLite。

### 追蹤的資料

目前使用 YouTube Data API 抓取：

- video id
- privacy status
- upload status
- processing status
- duration
- view count
- like count
- comment count
- favorite count
- raw YouTube response

這些資料存在 `youtube_performance_snapshots`。

### 同時保存發布實驗資料

專案不只存數據，也存每支影片的 creative setup，放在 `youtube_publish_experiments`。

包含：

- series
- title
- thumbnail path
- thumbnail concept
- visual style
- music style
- duration seconds
- track count
- 是否使用 telemetry overlay
- 是否每首 track 有獨立場景

這樣未來就能分析：

- 哪個 series 表現比較好？
- 哪種 thumbnail concept 比較有效？
- telemetry overlay 是否有幫助？
- per-track scenes 是否值得投入？
- 影片長度與觀看表現有沒有關聯？

### 追蹤指令

單支影片追蹤：

```powershell
npm run youtube:track-performance -- --channel orbital_focus --episode-id <episode-id>
```

追蹤整個 channel：

```powershell
npm run youtube:track-all-performance -- --channel orbital_focus
```

查看報表：

```powershell
npm run youtube:performance-report -- --channel orbital_focus --episode-id <episode-id>
```

### 建議追蹤節奏

- 上傳後立刻抓第一筆 snapshot。
- 發布初期每天追蹤一次。
- 一週後改成每週追蹤。
- 未來可以再接 YouTube Analytics API，補上 CTR、impressions、watch time、retention。

教學時可以說：

> 這套系統不是只幫我們生內容，它也開始幫我們建立內容實驗資料庫。每一次上傳，都是一次可以被追蹤和比較的實驗。

## 精簡版影片章節建議

1. 這個專案在做什麼
2. 串接了哪些 API
3. 使用了哪些服務與工具
4. 怎麼做人工審查
5. 怎麼定期追蹤 YouTube 數據
6. 這個專案真正值得學的地方

## 結尾總結

可以用這段作結：

> 這個專案真正的重點，不是單一 API 或單一模型，而是把 AI 內容生產變成一條可管理的工程流程。  
>  
> MiniMax 負責音樂生成，Codex/OpenAI 負責視覺素材，FFmpeg 和 Sharp 負責後製，Notion 負責人工審核，YouTube Data API 負責上傳與數據追蹤。  
>  
> 最後所有狀態、素材、審核與表現數據都回到 SQLite。這讓我們不是只做出一支影片，而是建立一套可以持續營運和優化的 AI 音樂頻道系統。
