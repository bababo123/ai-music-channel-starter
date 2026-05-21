# 學員快速開始

這份文件會帶你完成第一次啟動。預設先跑本機檢查與 dry run，不會一開始就呼叫付費 API。

## 1. 安裝必要工具

請先安裝：

- Node.js
- Git
- FFmpeg / ffprobe

安裝 dependencies：

```powershell
npm install
```

檢查本機環境：

```powershell
npm run student:doctor
```

## 2. 建立環境設定

複製 `.env.example`：

```powershell
Copy-Item .env.example .env
```

依照你要使用的服務填入 `.env`：

- MiniMax：AI 音樂生成
- OpenAI / Codex image workflow：圖片素材
- Notion：審核 dashboard
- YouTube OAuth：上傳與數據追蹤

不要把 secrets 貼到聊天對話。

## 3. 初始化資料庫

```powershell
npm run db:migrate
```

這會建立本機 SQLite database，並 seed 內建 series config。

## 4. 建立第一個 Episode Plan

```powershell
npm run episode:create -- --series orbital-systems --subtitle "Demo Episode"
```

## 5. 先跑 Dry Run

```powershell
npm run episode:generate -- --episode-id <episode-id> --dry-run
```

確認 episode id、prompt 和 output path 都正確後，再執行真實生成。

## 6. 如果你有私人 Skill

如果你已經從私人社群取得 `ai-music-channel-coach` skill，可以在 Codex 裡輸入：

```text
Use ai-music-channel-coach. Help me continue from my current setup state.
```

Agent 會依照你的目前狀態，引導你完成下一步。
