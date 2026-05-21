# Student Getting Started

Use this checklist for your first session.

## 1. Prepare Tools

Install:

- Node.js
- Git
- FFmpeg / ffprobe

Then run:

```powershell
npm install
npm run student:doctor
```

## 2. Prepare Secrets

Copy:

```powershell
Copy-Item .env.example .env
```

Fill only the services you plan to use:

- MiniMax for AI music generation.
- OpenAI or Codex image workflow for visual assets.
- Notion for the review dashboard.
- YouTube OAuth for upload and tracking.

Do not paste secrets into chat.

## 3. Initialize The Database

```powershell
npm run db:migrate
```

## 4. Create Your First Episode Plan

```powershell
npm run episode:create -- --series orbital-systems --subtitle "Demo Episode"
```

## 5. Preview Before Spending API Credits

```powershell
npm run episode:generate -- --episode-id <episode-id> --dry-run
```

Only run real generation after the dry run looks correct.

## 6. Ask The Skill For Help

Prompt:

```text
Use ai-music-channel-coach. Help me continue from my current setup state.
```

The agent should ask for missing setup details, run safe checks, and guide you through the next command.
