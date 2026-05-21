# AI Music Channel Starter

[繁體中文](README.md) | English

This is a student starter repo for building an AI music YouTube channel pipeline. It demonstrates how to turn AI music generation, image assets, audio processing, video rendering, human review, YouTube upload, and performance tracking into a repeatable content production workflow.

This public version contains runnable starter code and basic documentation only. The Codex coaching skill is distributed separately through the private community.

## What This Project Teaches

- Manage an AI content production workflow with a TypeScript CLI.
- Use SQLite to store episodes, tracks, assets, approvals, uploads, and performance snapshots.
- Connect AI music providers through a provider abstraction.
- Use FFmpeg / ffprobe for audio QC, mixing, and video processing.
- Use Sharp for deterministic thumbnail layout and typography.
- Optionally sync a Notion dashboard for human review.
- Use YouTube Data API for private upload, thumbnails, playlists, status checks, and lightweight performance tracking.
- Use dry runs and approval gates before publishing content.

## First Setup

Install dependencies:

```powershell
npm install
```

Create your local environment file:

```powershell
Copy-Item .env.example .env
```

Fill `.env` with your own credentials. Do not paste secrets into chat or issues.

Run the local environment doctor:

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

## Codex Coaching Skill

The Codex coaching skill is not included in this public repo. It is distributed separately through the private community.

After receiving the private skill package, see:

[docs/STUDENT_SKILL_INSTALLATION.md](docs/STUDENT_SKILL_INSTALLATION.md)

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

## Safety Defaults

- `.env`, local SQLite data, generated outputs, logs, and rendered videos are ignored by git.
- Always dry-run YouTube upload first.
- Real uploads should default to private.
- Create a publish package and approval decision before upload.

