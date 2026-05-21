# AI Music Channel Starter

繁體中文 | [English](README.en.md)

這是一個給學員使用的 AI 音樂 YouTube 頻道 starter repo。它示範如何把 AI 音樂生成、圖片素材、音訊處理、影片渲染、人工審查、YouTube 上傳與頻道數據追蹤，整理成一套可以重複執行的內容生產流程。

這個公開版本只包含可執行的 starter code 與基本文件。Codex 引導式教練 Skill 會另外透過私人社群提供。

## 這個專案會學到什麼

- 用 TypeScript CLI 管理 AI 內容生產流程。
- 用 SQLite 保存 episodes、tracks、assets、審核紀錄、上傳紀錄與數據快照。
- 用 provider abstraction 串接 AI 音樂生成服務。
- 用 FFmpeg / ffprobe 做音訊 QC、混音與影片處理。
- 用 Sharp 產生固定規格的縮圖與文字排版。
- 選擇性同步 Notion 作為人工審核 dashboard。
- 用 YouTube Data API 做 private upload、thumbnail、playlist、status check 和 performance tracking。
- 用 dry run 和 approval gate 避免直接把未審核內容上傳。

## 專案架構

```text
src/        TypeScript CLI、services、repositories、providers
scripts/    FFmpeg / HyperFrames / 環境檢查腳本
docs/       學員文件與教學說明
tests/      基礎測試
video/      HyperFrames 專案設定，不包含輸出影片
```

本 repo 不會追蹤：

- `.env`
- SQLite production data
- generated outputs
- logs
- rendered videos
- `node_modules`

## 第一次安裝

安裝 dependencies：

```powershell
npm install
```

建立本機環境設定檔：

```powershell
Copy-Item .env.example .env
```

請把自己的 API keys 和 OAuth 設定填進 `.env`。不要把 secrets 貼到聊天對話或 issue 裡。

檢查本機環境：

```powershell
npm run student:doctor
```

建立 SQLite database：

```powershell
npm run db:migrate
```

## 先用 Dry Run

建立一個 episode plan：

```powershell
npm run episode:create -- --series orbital-systems --subtitle "Demo Episode"
```

先預覽音樂生成流程，不呼叫真實 provider：

```powershell
npm run episode:generate -- --episode-id <episode-id> --dry-run
```

確認 prompt、output path 和 episode id 都正確之後，再執行真實生成。

## 主要流程

```powershell
npm run db:migrate
npm run episode:create -- --series <series-id> --subtitle "<subtitle>"
npm run episode:generate -- --episode-id <episode-id> --dry-run
npm run episode:generate -- --episode-id <episode-id>
npm run audio:qc -- --episode-id <episode-id>
npm run audio:mix -- --episode-id <episode-id>
npm run image:import-codex -- --episode-id <episode-id> --hero-path <hero.png> --thumbnail-path <thumbnail.png>
npm run youtube:package -- --episode-id <episode-id> --video-path <final-video.mp4>
npm run episode:approve -- --episode-id <episode-id> --reviewer "<name>"
npm run youtube:upload -- --channel <channel-key> --episode-id <episode-id> --dry-run
npm run youtube:track-performance -- --channel <channel-key> --episode-id <episode-id>
```

## 外部服務

完整流程會用到：

- MiniMax API：AI 音樂生成
- Codex / OpenAI image workflow：圖片素材
- FFmpeg / ffprobe：音訊與影片處理
- Notion API：人工審核 dashboard，可選
- YouTube Data API：上傳、playlist、status 與數據追蹤

沒有全部 API 也可以先從 planning、dry run、database migration 和文件導覽開始。

## Codex 教練 Skill

Codex 引導式教練 Skill 不包含在公開 repo 中。它會透過私人社群提供，協助學員：

- 收集頻道定位與 series 設定
- 檢查本機環境
- 引導填寫 `.env`
- 帶學員跑 episode production
- 做人工審核 checklist
- 做 YouTube upload dry run
- 建立定期數據追蹤習慣

收到私人社群提供的 skill 後，請參考：

[docs/STUDENT_SKILL_INSTALLATION.md](docs/STUDENT_SKILL_INSTALLATION.md)

## 安全預設

- `.env`、local SQLite、outputs、logs、rendered videos 都不進 git。
- YouTube 上傳前一定先跑 dry run。
- 真實上傳預設 private。
- 上傳前要先產生 publish package。
- 上傳前要有人工 approval decision。

## 文件

- [docs/STUDENT_GETTING_STARTED.md](docs/STUDENT_GETTING_STARTED.md)
- [docs/STUDENT_SKILL_INSTALLATION.md](docs/STUDENT_SKILL_INSTALLATION.md)
- [docs/YOUTUBE_TEACHING_GUIDE.md](docs/YOUTUBE_TEACHING_GUIDE.md)
- [docs/CODEX_IMAGE_WORKFLOW.md](docs/CODEX_IMAGE_WORKFLOW.md)
- [docs/NOTION_DASHBOARD.md](docs/NOTION_DASHBOARD.md)
- [docs/YOUTUBE_UPLOAD.md](docs/YOUTUBE_UPLOAD.md)

