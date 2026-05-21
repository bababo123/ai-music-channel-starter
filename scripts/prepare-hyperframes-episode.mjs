import Database from "better-sqlite3";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const episodeId = readArg("--episode-id");

if (!episodeId) {
  throw new Error("Usage: node scripts/prepare-hyperframes-episode.mjs --episode-id <episode-id>");
}

const db = new Database(resolve("data", "music-channel.sqlite"));
const episode = db
  .prepare("SELECT id, subtitle, title, thumbnail_text, output_dir FROM episodes WHERE id = ?")
  .get(episodeId);

if (!episode) {
  throw new Error(`Episode not found: ${episodeId}`);
}

const tracks = db
  .prepare(
    `
SELECT track_index, title, duration_target_seconds, duration_seconds
FROM tracks
WHERE episode_id = ?
ORDER BY track_index
`
  )
  .all(episodeId);
const assets = db
  .prepare("SELECT asset_type, file_path, metadata_json FROM assets WHERE episode_id = ?")
  .all(episodeId);
db.close();

const hero = findAsset(assets, "hero_image");
const finalAudio = findAsset(assets, "final_audio_mix");
const previewAudio = findAsset(assets, "audio_preview");
const durationSeconds = Number(finalAudio.metadata.durationSeconds);
const crossfadeSeconds = Number(finalAudio.metadata.crossfadeSeconds ?? 5);

if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
  throw new Error(`Final audio asset has invalid duration: ${finalAudio.file_path}`);
}

const projectDir = resolve("video", "hyperframes");
const assetDir = join(projectDir, "assets", "episode");
mkdirSync(assetDir, { recursive: true });
copyFileSync(hero.file_path, join(assetDir, "hero-1920x1080.png"));
copyFileSync(finalAudio.file_path, join(assetDir, "final-mix.mp3"));

if (previewAudio?.file_path) {
  copyFileSync(previewAudio.file_path, join(assetDir, "preview-60s.mp3"));
}

writeFileSync(join(projectDir, "index.html"), renderHtml({
  episode,
  tracks,
  durationSeconds,
  crossfadeSeconds
}), "utf8");

console.log(JSON.stringify({
  episodeId,
  projectDir,
  durationSeconds,
  crossfadeSeconds,
  trackCount: tracks.length
}, null, 2));

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function findAsset(assets, assetType) {
  const asset = assets.find((candidate) => candidate.asset_type === assetType);

  if (!asset?.file_path) {
    throw new Error(`Missing asset ${assetType}`);
  }

  return {
    file_path: asset.file_path,
    metadata: JSON.parse(asset.metadata_json)
  };
}

function renderHtml(input) {
  const chapters = buildChapters(input.tracks, input.crossfadeSeconds);
  const duration = input.durationSeconds.toFixed(6);
  const fadeStart = Math.max(0, input.durationSeconds - 8).toFixed(3);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      html,
      body {
        width: 1920px;
        height: 1080px;
        overflow: hidden;
        background: #020612;
        font-family: Arial, Helvetica, sans-serif;
      }

      #root {
        position: relative;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
        background: #020612;
      }

      .background {
        position: absolute;
        inset: -44px;
        width: calc(100% + 88px);
        height: calc(100% + 88px);
        object-fit: cover;
        transform-origin: 50% 50%;
        filter: saturate(0.92) contrast(1.03) brightness(0.88);
      }

      .vignette {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(circle at 50% 48%, rgba(7, 13, 24, 0) 0%, rgba(7, 13, 24, 0.16) 55%, rgba(0, 0, 0, 0.58) 100%),
          linear-gradient(180deg, rgba(0, 0, 0, 0.26), rgba(0, 0, 0, 0.12) 45%, rgba(0, 0, 0, 0.42));
      }

      .grain {
        position: absolute;
        inset: 0;
        opacity: 0.12;
        mix-blend-mode: soft-light;
        background-image:
          linear-gradient(0deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
        background-size: 7px 7px, 11px 11px;
      }

      .title-block {
        position: absolute;
        left: 88px;
        bottom: 92px;
        color: #f4f7fb;
        opacity: 0;
        text-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
      }

      .series {
        font-size: 56px;
        font-weight: 800;
        letter-spacing: 0;
      }

      .subtitle {
        margin-top: 14px;
        font-size: 25px;
        color: #c9d6e5;
        font-weight: 500;
        letter-spacing: 0;
      }

      .chapter {
        position: absolute;
        right: 78px;
        bottom: 76px;
        max-width: 720px;
        color: #d8e4f0;
        opacity: 0;
        text-align: right;
        text-shadow: 0 10px 40px rgba(0, 0, 0, 0.58);
      }

      .chapter-number {
        font-size: 18px;
        color: #98a9bb;
        margin-bottom: 7px;
        letter-spacing: 0;
      }

      .chapter-title {
        font-size: 34px;
        font-weight: 650;
        letter-spacing: 0;
      }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${duration}"
      data-width="1920"
      data-height="1080"
    >
      <img
        id="bg"
        class="background clip"
        data-start="0"
        data-duration="${duration}"
        data-track-index="0"
        src="assets/episode/hero-1920x1080.png"
      />
      <div id="vignette" class="vignette clip" data-start="0" data-duration="${duration}" data-track-index="1"></div>
      <div id="grain" class="grain clip" data-start="0" data-duration="${duration}" data-track-index="2"></div>

      <div id="title" class="title-block clip" data-start="0" data-duration="18" data-track-index="3">
        <div class="series">${escapeHtml(input.episode.thumbnail_text)}</div>
        <div class="subtitle">${escapeHtml(input.episode.subtitle)}</div>
      </div>

${chapters.map((chapter, index) => renderChapter(chapter, index + 4)).join("\n")}

      <audio
        id="final-audio"
        data-start="0"
        data-duration="${duration}"
        data-track-index="${chapters.length + 4}"
        data-volume="1"
        src="assets/episode/final-mix.mp3"
      ></audio>
    </div>

    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });

      tl.fromTo("#bg", { scale: 1.045, x: -14, y: -10 }, { scale: 1.145, x: 24, y: 16, duration: ${duration}, ease: "none" }, 0);
      tl.fromTo("#grain", { opacity: 0.08 }, { opacity: 0.16, duration: 18, yoyo: true, repeat: ${Math.max(1, Math.floor(input.durationSeconds / 18))}, ease: "sine.inOut" }, 0);
      tl.fromTo("#title", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 2.2, ease: "power2.out" }, 1.2);
      tl.to("#title", { opacity: 0, y: -10, duration: 2.6, ease: "power2.inOut" }, 14.6);

      document.querySelectorAll(".chapter").forEach((chapter) => {
        const start = Number(chapter.dataset.start || 0);
        tl.fromTo(chapter, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 1.2, ease: "power2.out" }, start + 0.4);
        tl.to(chapter, { opacity: 0, y: -8, duration: 1.4, ease: "power2.inOut" }, start + 6.4);
      });

      tl.to("#root", { opacity: 0, duration: 8, ease: "power1.inOut" }, ${fadeStart});
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
}

function renderChapter(chapter, trackIndex) {
  return `      <div id="chapter-${chapter.index.toString().padStart(2, "0")}" class="chapter clip" data-start="${chapter.start.toFixed(3)}" data-duration="8" data-track-index="${trackIndex}">
        <div class="chapter-number">${chapter.index.toString().padStart(2, "0")}</div>
        <div class="chapter-title">${escapeHtml(chapter.title)}</div>
      </div>`;
}

function buildChapters(tracks, crossfadeSeconds) {
  let elapsed = 0;

  return tracks.map((track, index) => {
    const chapter = {
      index: track.track_index,
      title: track.title,
      start: elapsed
    };
    const durationSeconds = Number(track.duration_seconds ?? track.duration_target_seconds);

    if (index < tracks.length - 1) {
      elapsed += Math.max(0, durationSeconds - crossfadeSeconds);
    }

    return chapter;
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
