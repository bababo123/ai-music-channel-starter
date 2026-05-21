# AI Music Channel Coach Workflows

## 1. First-Time Setup

Goal: get the starter project ready without making paid API calls.

1. Confirm the student has the project open at the repo root.
2. Ask them to copy `.env.example` to `.env`.
3. Tell them to fill secrets in `.env`, not in chat.
4. Run:

```powershell
npm install
node skills/ai-music-channel-coach/scripts/project-doctor.mjs
npm run db:migrate
```

5. If any service is missing, decide whether to configure it now or continue in local/dry-run mode.

## 2. Channel Planning

Goal: turn the student's channel idea into usable series settings.

Collect:

- Channel audience and use case.
- First 1-3 recurring series.
- Sound identity per series.
- Visual identity per series.
- Thumbnail text per series.

Explain that series settings should be stable. Episode subtitles can change, but series identity should stay consistent.

## 3. Episode Production

Goal: produce one review package from a planned episode.

Start with:

```powershell
npm run episode:create -- --series <series-id> --subtitle "<subtitle>"
npm run episode:generate -- --episode-id <episode-id> --dry-run
```

Then continue only when the student is ready to call real providers:

```powershell
npm run episode:generate -- --episode-id <episode-id>
npm run audio:qc -- --episode-id <episode-id>
npm run audio:mix -- --episode-id <episode-id>
```

For images, prefer importing selected generated images:

```powershell
npm run image:import-codex -- --episode-id <episode-id> --hero-path <hero.png> --thumbnail-path <thumbnail.png>
```

## 4. Video and Publish Package

Goal: create reviewable artifacts before upload.

Ask for the final rendered MP4 path. Then run:

```powershell
npm run youtube:package -- --episode-id <episode-id> --video-path <final-video.mp4>
```

Tell the student to review:

- final MP4
- final thumbnail
- final audio
- 60-second preview
- title
- description
- chapters
- tags
- pinned comment

## 5. Review and Approval

Goal: keep a human gate before upload.

Use this checklist:

- First 30 seconds feel appropriate for YouTube.
- No distracting audio at 15, 30, and 50 minutes.
- Thumbnail text is correct.
- Metadata is accurate and not spammy.
- Synthetic/AI-assisted disclosure is planned.
- Visibility is private unless explicitly changed.

Then run:

```powershell
npm run episode:approve -- --episode-id <episode-id> --reviewer "<name>" --notes "<short notes>"
```

## 6. YouTube Upload

Goal: verify upload inputs before calling YouTube.

Always dry run first:

```powershell
npm run youtube:upload -- --channel <channel-key> --episode-id <episode-id> --dry-run
```

Confirm:

- target channel
- visibility
- video path
- thumbnail path
- playlist target
- title and description

Then upload:

```powershell
npm run youtube:upload -- --channel <channel-key> --episode-id <episode-id>
```

## 7. Performance Tracking

Goal: build a lightweight learning loop after publishing.

Single episode:

```powershell
npm run youtube:track-performance -- --channel <channel-key> --episode-id <episode-id>
npm run youtube:performance-report -- --channel <channel-key> --episode-id <episode-id>
```

All uploaded videos:

```powershell
npm run youtube:track-all-performance -- --channel <channel-key>
```

Recommended cadence:

- First snapshot after upload.
- Daily during the first week.
- Weekly after the first week.

Explain that this project currently uses YouTube Data API snapshots. Full retention, impressions, CTR, and watch time require YouTube Analytics API in a later phase.
