# Codex 教練 Skill 安裝說明

[README](../README.md) 預設使用繁體中文。Codex 教練 Skill 不包含在公開 repo 中，會另外透過私人社群提供。

## 為什麼 Skill 不放在公開 Repo

公開 repo 負責提供可執行的 starter code。私人 skill 則負責提供課程引導、學員 intake、審核 checklist、操作節奏與教學助教流程。

這樣可以讓公開 repo 保持乾淨，同時把課程加值內容留在私人社群中。

## 安裝方式

收到私人社群提供的資料夾後，應該會看到：

```text
ai-music-channel-coach/
  SKILL.md
  references/
  templates/
  scripts/
```

把整個資料夾複製到你的 Codex skills 目錄，例如：

```text
C:\Users\<student>\.codex\skills\ai-music-channel-coach\
```

複製完成後，重新啟動 Codex，讓 skill list 重新載入。

## 第一個 Prompt

建議在 starter repo 根目錄開啟 Codex，然後輸入：

```text
Use ai-music-channel-coach. 我想設定 AI music channel starter project，請先帶我做 intake 和 setup check。
```

Skill 會引導你：

- 收集頻道定位
- 確認本機工具
- 檢查 `.env`
- 規劃第一個 series / episode
- 先跑 dry run
- 建立人工審查流程
- 設定 YouTube 上傳與數據追蹤

## 注意事項

- 不要把 API keys 或 OAuth tokens 貼到聊天對話。
- secrets 請放在 `.env`。
- 真實 API 呼叫前先跑 dry run。
- YouTube 上傳前先產生 publish package。
- 真實上傳預設使用 private。
- 上傳前必須完成人工 approval。

