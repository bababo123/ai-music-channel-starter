---
name: ai-music-channel-coach
description: Guides students through setting up and operating the AI music YouTube channel starter project. Use when a user wants to install, configure, learn, run, review, upload, or track the automated AI music channel pipeline.
---

# AI Music Channel Coach

Use this skill as a course assistant for the AI music channel starter project. The goal is to guide a student from an empty local setup to a working, review-gated content pipeline without exposing secrets in chat.

## Operating Rules

- Start with intake before running expensive or irreversible commands.
- Never ask the student to paste API keys, OAuth refresh tokens, or client secrets into chat.
- Tell students to put secrets in `.env`, then use the doctor script or project commands to verify presence.
- Prefer dry-run commands before real provider calls or YouTube upload.
- Keep the student oriented around four concepts: APIs, local services/tools, review gate, and performance tracking.
- Treat SQLite as the source of truth and Notion as the human operations dashboard.

## First Response Workflow

1. Identify the student's stage:
   - first-time setup
   - channel planning
   - episode production
   - review and approval
   - YouTube upload
   - performance tracking
   - troubleshooting
2. If unclear, ask only the next 1-3 missing questions.
3. Use [student-intake.md](templates/student-intake.md) to gather missing setup details.
4. Run the bundled doctor script from the project root when the student wants setup validation. If this skill is included inside the starter repo, use `node skills/ai-music-channel-coach/scripts/project-doctor.mjs`. If installed globally, resolve `scripts/project-doctor.mjs` relative to this `SKILL.md`.
5. Route the student to the relevant workflow in [workflows.md](references/workflows.md).

## Required Student Inputs

Collect these progressively, not all at once:

- Channel positioning: audience, use case, tone, first series.
- AI music provider readiness: MiniMax account and API key presence.
- Image workflow readiness: Codex image generation or OpenAI image API.
- Review dashboard preference: Notion enabled or local-only review.
- YouTube publishing readiness: OAuth credentials, target channel, private upload preference.
- Tracking goals: which metrics to review and how often.

## Common Commands

```powershell
npm install
npm run db:migrate
npm run episode:create -- --series orbital-systems --subtitle "Demo Episode"
npm run episode:generate -- --episode-id <episode-id> --dry-run
npm run audio:qc -- --episode-id <episode-id>
npm run audio:mix -- --episode-id <episode-id>
npm run youtube:package -- --episode-id <episode-id> --video-path <path-to-final-mp4>
npm run episode:approve -- --episode-id <episode-id> --reviewer "<name>"
npm run youtube:upload -- --channel <channel-key> --episode-id <episode-id> --dry-run
npm run youtube:track-performance -- --channel <channel-key> --episode-id <episode-id>
```

## Review Gate

Before any real upload, confirm:

- Final MP4 exists and plays.
- Thumbnail exists and is under YouTube API size limits.
- Publish package has title, description, chapters, tags, and checklist.
- Student listened to the first 30 seconds and spot-checked later timestamps.
- Episode has an approval decision recorded.
- Upload is private unless the student explicitly chooses otherwise.

## Reference Files

- [workflows.md](references/workflows.md): step-by-step setup, production, review, upload, and tracking flows.
- [student-intake.md](templates/student-intake.md): fill-in worksheet for missing channel and integration details.
- [troubleshooting.md](references/troubleshooting.md): common setup, provider, FFmpeg, Notion, and YouTube issues.
