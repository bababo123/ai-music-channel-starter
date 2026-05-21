# AI Music Channel Starter

Student starter kit for building a review-gated AI music YouTube channel pipeline.

This repo demonstrates how to turn AI-generated music, image assets, audio processing, video rendering, human review, YouTube upload, and performance tracking into one maintainable workflow.

## What This Project Teaches

- AI music generation through a provider abstraction.
- Local workflow orchestration with TypeScript CLI commands.
- SQLite as the source of truth for episodes, tracks, assets, approvals, uploads, and performance snapshots.
- Audio QC and mixing with FFmpeg / ffprobe.
- Programmatic thumbnails with Sharp.
- Optional Notion dashboard sync for human review.
- YouTube Data API upload, status checks, playlist insertion, and lightweight performance tracking.
- A Codex skill that guides students through setup and operation.

## First Setup

Install dependencies:

```powershell
npm install
```

Create your local environment file:

```powershell
Copy-Item .env.example .env
```

Fill `.env` with your own credentials. Do not paste secrets into chat.

Run the student doctor:

```powershell
npm run student:doctor
```

Create the local SQLite database:

```powershell
npm run db:migrate
```

## Start With Dry Runs

Create a planned episode:

```powershell
npm run episode:create -- --series orbital-systems --subtitle "Demo Episode"
```

Preview music generation without calling the provider:

```powershell
npm run episode:generate -- --episode-id <episode-id> --dry-run
```

## Course Skill

This repo includes a Codex skill:

```text
skills/ai-music-channel-coach/
```

Suggested first prompt:

```text
Use ai-music-channel-coach. I want to set up the AI music channel starter project. Please guide me through the intake and setup checks.
```

See [docs/STUDENT_SKILL_INSTALLATION.md](docs/STUDENT_SKILL_INSTALLATION.md) for installation options.

## Safety Defaults

- `.env`, local SQLite data, generated outputs, logs, and rendered videos are ignored by git.
- YouTube upload should be dry-run first.
- Real uploads should default to private.
- A publish package and approval decision should exist before upload.

## Main Workflow

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

## Included Documentation

- [docs/YOUTUBE_TEACHING_GUIDE.md](docs/YOUTUBE_TEACHING_GUIDE.md)
- [docs/STUDENT_SKILL_INSTALLATION.md](docs/STUDENT_SKILL_INSTALLATION.md)
- [docs/CODEX_IMAGE_WORKFLOW.md](docs/CODEX_IMAGE_WORKFLOW.md)
- [docs/NOTION_DASHBOARD.md](docs/NOTION_DASHBOARD.md)
- [docs/YOUTUBE_UPLOAD.md](docs/YOUTUBE_UPLOAD.md)

