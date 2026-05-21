# Troubleshooting

## Setup Issues

If `npm install` fails, check Node.js version first. The project is intended for modern Node.js and TypeScript tooling.

If `tsx` commands fail, make sure dependencies are installed and run from the project root.

## FFmpeg Issues

If audio QC or rendering fails, run:

```powershell
ffmpeg -version
ffprobe -version
```

If either command is missing, install FFmpeg and make sure it is on `PATH`.

Windows FFmpeg rendering can fail on path or text escaping. Prefer existing scripts instead of hand-building filter graphs.

## MiniMax Issues

Common causes:

- Missing `MINIMAX_API_KEY`
- Usage limit exceeded
- Temporary network failure
- Provider response shape changed
- Prompt too long

Use dry run first to inspect planned prompts and output paths.

## Image Issues

Do not ask the image model to generate final thumbnail text. Generate the background image, then let Sharp render final typography.

If thumbnail upload fails, check file size. YouTube thumbnail API has a small file size limit.

## Notion Issues

If sync fails, confirm:

- `NOTION_API_KEY` is present in `.env`
- `NOTION_DATABASE_ID` points to the target data source or accepted page/database ID
- The Notion integration has access to the target page/database

Use:

```powershell
npm run notion:schema
npm run notion:ensure-schema
```

## YouTube Issues

If upload works but status or playlist commands fail, OAuth scopes may be incomplete. Re-authorize with both upload and YouTube management scopes.

Always run upload dry run before real upload:

```powershell
npm run youtube:upload -- --channel <channel-key> --episode-id <episode-id> --dry-run
```

If playlist insertion fails after upload, do not re-upload the video. Retry playlist insertion with the repair command.
