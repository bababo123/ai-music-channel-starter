import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import Database from "better-sqlite3";

const episodeId = readArg("--episode-id");
const outputPath = readArg("--output") ?? resolve("video", "renders", `${episodeId}-final.mp4`);

if (!episodeId) {
  throw new Error("Usage: node scripts/render-ffmpeg-episode-video.mjs --episode-id <episode-id> [--output <mp4>]");
}

const db = new Database(resolve("data", "music-channel.sqlite"));
const episode = db
  .prepare("SELECT id, subtitle, title, thumbnail_text FROM episodes WHERE id = ?")
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
const durationSeconds = Number(finalAudio.metadata.durationSeconds);
const crossfadeSeconds = Number(finalAudio.metadata.crossfadeSeconds ?? 5);

if (!existsSync(hero.file_path)) {
  throw new Error(`Hero image not found: ${hero.file_path}`);
}

if (!existsSync(finalAudio.file_path)) {
  throw new Error(`Final audio not found: ${finalAudio.file_path}`);
}

if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
  throw new Error(`Invalid final audio duration: ${durationSeconds}`);
}

mkdirSync(resolve("video", "renders"), { recursive: true });

const fps = 24;
const totalFrames = Math.ceil(durationSeconds * fps);
const filter = buildFilter({
  episode,
  tracks,
  durationSeconds,
  totalFrames,
  fps,
  crossfadeSeconds
});

const args = [
  "-y",
  "-hide_banner",
  "-loop",
  "1",
  "-i",
  hero.file_path,
  "-i",
  finalAudio.file_path,
  "-filter_complex",
  filter,
  "-map",
  "[vout]",
  "-map",
  "1:a",
  "-t",
  durationSeconds.toFixed(3),
  "-r",
  String(fps),
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  "22",
  "-maxrate",
  "6M",
  "-bufsize",
  "12M",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  "-b:a",
  "192k",
  "-ar",
  "48000",
  "-movflags",
  "+faststart",
  outputPath
];

console.log(JSON.stringify({
  episodeId,
  renderer: "ffmpeg",
  outputPath,
  durationSeconds,
  totalFrames,
  hero: basename(hero.file_path),
  audio: basename(finalAudio.file_path)
}, null, 2));

execFileSync("ffmpeg", args, { stdio: "inherit" });

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

function buildFilter(input) {
  const filters = [];
  const zoomEnd = 1.08;
  const zoomExpression = `1+${(zoomEnd - 1).toFixed(4)}*on/${input.totalFrames}`;
  filters.push(
    `[0:v]scale=2200:1238:force_original_aspect_ratio=increase,crop=2200:1238,zoompan=z='${zoomExpression}':x='iw/2-(iw/zoom/2)+sin(on/900)*18':y='ih/2-(ih/zoom/2)+cos(on/1100)*10':d=${input.totalFrames}:s=1920x1080:fps=${input.fps},format=yuv420p[v0]`
  );

  let current = "v0";
  let nextIndex = 1;
  const addDraw = (options) => {
    const next = `v${nextIndex}`;
    nextIndex += 1;
    filters.push(`[${current}]drawtext=${drawTextArgs(options)}[${next}]`);
    current = next;
  };

  addDraw({
    text: input.episode.thumbnail_text,
    x: "88",
    y: "h-188",
    fontSize: 56,
    fontColor: "F4F7FB@0.92",
    font: "arialbd.ttf",
    enable: "between(t,1.2,14.6)"
  });
  addDraw({
    text: input.episode.subtitle,
    x: "88",
    y: "h-124",
    fontSize: 25,
    fontColor: "C9D6E5@0.92",
    enable: "between(t,1.2,14.6)"
  });

  for (const chapter of buildChapters(input.tracks, input.crossfadeSeconds)) {
    const start = chapter.start.toFixed(3);
    const end = (chapter.start + 8).toFixed(3);
    addDraw({
      text: chapter.index.toString().padStart(2, "0"),
      x: "w-tw-78",
      y: "h-130",
      fontSize: 18,
      fontColor: "98A9BB@0.92",
      enable: `between(t,${start},${end})`
    });
    addDraw({
      text: chapter.title,
      x: "w-tw-78",
      y: "h-92",
      fontSize: 34,
      fontColor: "D8E4F0@0.96",
      font: "arialbd.ttf",
      enable: `between(t,${start},${end})`
    });
  }

  filters.push(`[${current}]fade=t=out:st=${Math.max(0, input.durationSeconds - 8).toFixed(3)}:d=8[vout]`);

  return filters.join(";");
}

function drawTextArgs(input) {
  const font = input.font ?? "arial.ttf";

  return [
    `fontfile='${escapeFilterPath(resolve("C:/Windows/Fonts", font))}'`,
    `text='${escapeDrawText(input.text)}'`,
    `x=${input.x}`,
    `y=${input.y}`,
    `fontsize=${input.fontSize}`,
    `fontcolor=${input.fontColor}`,
    "shadowcolor=000000@0.58",
    "shadowx=2",
    "shadowy=2",
    `enable='${input.enable}'`
  ].join(":");
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

function escapeFilterPath(value) {
  return value.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1\\:");
}

function escapeDrawText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}
