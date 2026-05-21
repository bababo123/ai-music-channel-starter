# Codex Image Workflow

This is the default image workflow for the channel. Codex-generated images are used instead of calling the OpenAI Images API from the Node pipeline.

## Why

Codex built-in image generation is an interactive tool available to the agent, not a Node.js provider that the CLI can call directly. The pipeline therefore treats Codex images as generated external assets and imports them into the same episode asset flow.

## Flow

1. Create or select an episode.
2. Ask Codex to generate one hero image and one thumbnail source image from the episode prompts.
3. Keep the generated originals under `C:\Users\pooh7\.codex\generated_images\...`.
4. Import the chosen files into the project:

```powershell
npm run image:import-codex -- `
  --episode-id 2026-05-07-lunar-night-shift-silent-crater-relay `
  --hero-path D:\path\to\hero.png `
  --thumbnail-path D:\path\to\thumbnail.png
```

The import command will:

- copy source images into `outputs/{episodeId}/images/raw/`
- render `hero-1920x1080.png`
- render `thumbnail-base-1280x720.png`
- overlay the series name and subtitle into `thumbnail-final-1280x720.png`
- save `hero_image`, `thumbnail_base`, and `thumbnail_final` assets in SQLite
- mark the episode as `images_ready`

## Notes

- The stored provider defaults to `codex`.
- The stored model label defaults to `gpt-image-2`.
- You can override labels with `--provider-label` and `--model-label`.
- Downstream video rendering, YouTube packaging, and Notion sync continue to use the same asset records.
- Do not use `npm run image:generate` for normal production episodes unless explicitly testing the API provider.
- Keep the final artificial title typography in Sharp, not inside the generated image, so thumbnails remain consistent and editable.
