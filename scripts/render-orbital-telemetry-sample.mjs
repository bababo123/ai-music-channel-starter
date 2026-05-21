import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import sharp from "sharp";

const defaultEpisodeId = "2026-05-19-orbital-systems-orbital-systems";
const episodeId = readArg("--episode-id") ?? defaultEpisodeId;
const trackIndex = readPositiveIntArg("--track-index", 1);
const fps = readPositiveIntArg("--fps", 24);
const sceneDir = readArg("--scene-dir") ?? resolve("outputs", episodeId, "images", "scenes");
const outputPath =
  readArg("--output") ??
  resolve("video", "renders", `${episodeId}-track-${String(trackIndex).padStart(2, "0")}-telemetry-sample.mp4`);
const durationCapSeconds = readOptionalPositiveNumberArg("--duration-cap");
const edgeShadePath =
  readArg("--edge-shade") ?? resolve("video", "renders", "assets", "edge-shade-right-20.png");
const telemetryOverlayPath =
  readArg("--telemetry-overlay") ??
  resolve("video", "renders", "assets", `${episodeId}-track-${String(trackIndex).padStart(2, "0")}-telemetry.mov`);

const db = new Database(resolve("data", "music-channel.sqlite"));
const episode = db
  .prepare("SELECT id, subtitle, title, thumbnail_text FROM episodes WHERE id = ?")
  .get(episodeId);
const track = db
  .prepare(
    `
SELECT track_index, title, file_path, duration_seconds, duration_target_seconds
FROM tracks
WHERE episode_id = ? AND track_index = ?
`
  )
  .get(episodeId, trackIndex);
db.close();

if (!episode) {
  throw new Error(`Episode not found: ${episodeId}`);
}

if (!track) {
  throw new Error(`Track not found: ${episodeId} #${trackIndex}`);
}

if (!track.file_path || !existsSync(track.file_path)) {
  throw new Error(`Missing audio file for track ${trackIndex}: ${track.file_path ?? "(empty)"}`);
}

const imagePath = findSceneImage(sceneDir, track);
const durationSeconds = probeDurationSeconds(track.file_path);
const renderDurationSeconds = durationCapSeconds
  ? Math.min(durationCapSeconds, durationSeconds)
  : durationSeconds;
const totalFrames = Math.ceil(renderDurationSeconds * fps);

mkdirSync(dirname(outputPath), { recursive: true });
await ensureEdgeShade(edgeShadePath);

const telemetry = analyzeAudio(track.file_path, {
  fps,
  durationSeconds: renderDurationSeconds,
  bandCount: 50
});
await renderTelemetryOverlay(telemetry, {
  outputPath: telemetryOverlayPath,
  fps,
  width: 1160,
  height: 58
});

const filter = buildFilter({
  episode,
  track,
  durationSeconds: renderDurationSeconds,
  totalFrames,
  fps
});

const args = [
  "-y",
  "-hide_banner",
  "-loop",
  "1",
  "-framerate",
  String(fps),
  "-t",
  renderDurationSeconds.toFixed(3),
  "-i",
  imagePath,
  "-loop",
  "1",
  "-framerate",
  String(fps),
  "-t",
  renderDurationSeconds.toFixed(3),
  "-i",
  edgeShadePath,
  "-i",
  telemetryOverlayPath,
  "-i",
  track.file_path,
  "-filter_complex",
  filter,
  "-map",
  "[vout]",
  "-map",
  "[aout]",
  "-t",
  renderDurationSeconds.toFixed(3),
  "-r",
  String(fps),
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  "22",
  "-maxrate",
  "8M",
  "-bufsize",
  "16M",
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

const manifest = {
  episodeId,
  trackIndex,
  title: track.title,
  outputPath,
  imagePath,
  telemetryOverlayPath,
  edgeShadePath,
  fps,
  durationSeconds,
  renderDurationSeconds,
  totalFrames,
  telemetry: {
    bandCount: telemetry.bandCount,
    sampleRate: telemetry.sampleRate,
    windowSize: telemetry.windowSize
  }
};

writeFileSync(replaceExtension(outputPath, ".json"), JSON.stringify(manifest, null, 2), "utf8");
console.log(JSON.stringify(manifest, null, 2));
execFileSync("ffmpeg", args, { stdio: "inherit" });

function buildFilter(input) {
  const zoomEnd = 1.024;
  const zoomExpression = `1+${(zoomEnd - 1).toFixed(4)}*on/${input.totalFrames}`;
  const progress = `on/${Math.max(1, input.totalFrames - 1)}`;
  const xPosition = `iw/2-(iw/zoom/2)+(iw-iw/zoom)*(0.26+(0.33-0.26)*${progress})`;
  const yPosition = `ih/2-(ih/zoom/2)+(ih-ih/zoom)*(0.48+(0.52-0.48)*${progress})`;
  const fadeOutStart = Math.max(0, input.durationSeconds - 8).toFixed(3);
  const filters = [
    `[0:v]scale=2240:1260:force_original_aspect_ratio=increase,crop=2240:1260,` +
      `zoompan=z='${zoomExpression}':x='${xPosition}':y='${yPosition}':` +
      `d=${input.totalFrames}:s=1920x1080:fps=${input.fps},` +
      "eq=contrast=1.025:saturation=0.96:brightness=0,format=yuv420p[vscene]",
    "[1:v]format=rgba[edgeShade]",
    "[vscene][edgeShade]overlay=shortest=1:format=auto,gradfun=strength=0.7:radius=16,format=yuv420p[vshade]",
    "[2:v]format=rgba[telemetry]",
    "[vshade][telemetry]overlay=x=(main_w-overlay_w)/2:y=main_h-116:shortest=1:format=auto[vtelemetry]"
  ];

  let current = "vtelemetry";
  let nextIndex = 0;
  const addDraw = (options) => {
    const next = `draw${nextIndex}`;
    nextIndex += 1;
    filters.push(`[${current}]drawtext=${drawTextArgs(options)}[${next}]`);
    current = next;
  };

  addDraw({
    text: input.episode.thumbnail_text ?? "ORBITAL FOCUS",
    x: "88",
    y: "h-188",
    fontSize: 56,
    fontColor: "F4F7FB@0.92",
    font: "arialbd.ttf",
    enable: "between(t,1.0,14.6)"
  });
  addDraw({
    text: "Telemetry Pulse Test",
    x: "88",
    y: "h-124",
    fontSize: 25,
    fontColor: "C9D6E5@0.92",
    enable: "between(t,1.0,14.6)"
  });
  addDraw({
    text: String(input.track.track_index).padStart(2, "0"),
    x: "w-tw-78",
    y: "h-130",
    fontSize: 18,
    fontColor: "98A9BB@0.92",
    enable: `between(t,0.7,${input.durationSeconds.toFixed(3)})`
  });
  addDraw({
    text: input.track.title,
    x: "w-tw-78",
    y: "h-92",
    fontSize: 34,
    fontColor: "D8E4F0@0.96",
    font: "arialbd.ttf",
    enable: `between(t,0.7,${input.durationSeconds.toFixed(3)})`
  });

  filters.push(`[${current}]fade=t=in:st=0:d=2,fade=t=out:st=${fadeOutStart}:d=8[vout]`);
  filters.push(
    `[3:a]aresample=48000,volume=0.74,alimiter=limit=0.74:level=false[aout]`
  );

  return filters.join(";");
}

function analyzeAudio(audioPath, options) {
  const sampleRate = 16000;
  const windowSize = 1024;
  const tempDir = mkdtempSync(join(tmpdir(), "orbital-telemetry-"));
  const pcmPath = join(tempDir, "audio.f32le");

  try {
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        audioPath,
        "-ac",
        "1",
        "-ar",
        String(sampleRate),
        "-f",
        "f32le",
        pcmPath
      ],
      { stdio: "inherit" }
    );

    const pcm = readFileSync(pcmPath);
    const samples = new Float32Array(pcm.length / 4);

    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = pcm.readFloatLE(index * 4);
    }

    const frameCount = Math.ceil(options.durationSeconds * options.fps);
    const bands = buildBands(options.bandCount, 70, 6200);
    const raw = Array.from({ length: frameCount }, () => new Float32Array(options.bandCount));
    const maxima = new Float32Array(options.bandCount);
    const hann = new Float32Array(windowSize);

    for (let index = 0; index < windowSize; index += 1) {
      hann[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / Math.max(1, windowSize - 1));
    }

    const coefficients = bands.map((frequency) => 2 * Math.cos((2 * Math.PI * frequency) / sampleRate));

    for (let frame = 0; frame < frameCount; frame += 1) {
      const center = Math.round((frame / options.fps) * sampleRate);
      const start = center - Math.floor(windowSize / 2);

      for (let band = 0; band < options.bandCount; band += 1) {
        let previous = 0;
        let previous2 = 0;
        const coefficient = coefficients[band];

        for (let offset = 0; offset < windowSize; offset += 1) {
          const sampleIndex = start + offset;
          const sample =
            sampleIndex >= 0 && sampleIndex < samples.length
              ? samples[sampleIndex] * hann[offset]
              : 0;
          const value = sample + coefficient * previous - previous2;
          previous2 = previous;
          previous = value;
        }

        const power = previous2 * previous2 + previous * previous - coefficient * previous * previous2;
        const magnitude = Math.sqrt(Math.max(0, power)) / windowSize;
        raw[frame][band] = magnitude;

        if (magnitude > maxima[band]) {
          maxima[band] = magnitude;
        }
      }
    }

    for (let band = 0; band < options.bandCount; band += 1) {
      const values = raw.map((frame) => frame[band]).sort((a, b) => a - b);
      maxima[band] = Math.max(values[Math.floor(values.length * 0.96)] ?? maxima[band], 0.000001);
    }

    const smooth = Array.from({ length: frameCount }, () => new Float32Array(options.bandCount));
    const previous = new Float32Array(options.bandCount);

    for (let frame = 0; frame < frameCount; frame += 1) {
      for (let band = 0; band < options.bandCount; band += 1) {
        const normalized = Math.min(1, Math.pow(raw[frame][band] / maxima[band], 0.58));
        previous[band] = previous[band] * 0.72 + normalized * 0.28;
        smooth[frame][band] = previous[band];
      }
    }

    return {
      fps: options.fps,
      sampleRate,
      windowSize,
      bandCount: options.bandCount,
      frames: smooth
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function renderTelemetryOverlay(telemetry, options) {
  mkdirSync(dirname(options.outputPath), { recursive: true });

  const ffmpeg = spawn(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "-s",
      `${options.width}x${options.height}`,
      "-r",
      String(options.fps),
      "-i",
      "-",
      "-c:v",
      "qtrle",
      options.outputPath
    ],
    { stdio: ["pipe", "inherit", "inherit"] }
  );

  for (const frame of telemetry.frames) {
    const buffer = renderTelemetryFrame(frame, options.width, options.height);

    if (!ffmpeg.stdin.write(buffer)) {
      await onceDrain(ffmpeg.stdin);
    }
  }

  ffmpeg.stdin.end();
  const code = await waitForProcess(ffmpeg);

  if (code !== 0) {
    throw new Error(`Failed to render telemetry overlay: ffmpeg exited with ${code}`);
  }
}

function renderTelemetryFrame(frame, width, height) {
  const buffer = Buffer.alloc(width * height * 4);
  const left = 0;
  const right = width - 2;
  const baselineY = height - 13;
  const barCount = frame.length;
  const barWidth = 3;
  const gap = 5;
  const barsWidth = barCount * barWidth + (barCount - 1) * gap;
  const startX = Math.round((width - barsWidth) / 2);

  fillRect(buffer, width, left, baselineY, right, 1, 154, 218, 236, 42);
  fillRect(buffer, width, left + 66, baselineY + 5, 46, 1, 154, 218, 236, 30);
  fillRect(buffer, width, left + 124, baselineY + 5, 18, 1, 154, 218, 236, 30);

  for (let band = 0; band < barCount; band += 1) {
    const x = startX + band * (barWidth + gap);
    const level = Math.min(1, Math.max(0, frame[band]));
    const barHeight = Math.round(4 + level * 28);
    const y = baselineY - barHeight;
    const alpha = Math.round(42 + level * 78);
    const glowAlpha = Math.round(14 + level * 34);

    fillRect(buffer, width, x - 2, y - 1, barWidth + 4, barHeight + 2, 120, 205, 230, glowAlpha);
    fillRect(buffer, width, x, y, barWidth, barHeight, 200, 240, 255, alpha);
  }

  for (let x = 0; x <= width; x += 54) {
    fillRect(buffer, width, x, baselineY + 8, 2, 2, 154, 218, 236, 40);
  }

  return buffer;
}

async function ensureEdgeShade(filePath) {
  if (existsSync(filePath)) {
    return;
  }

  const width = 1920;
  const height = 1080;
  const startX = Math.round(width * 0.8);
  const fadeWidth = width - startX;
  const maxAlpha = 0.28;
  const pixels = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const t = x < startX ? 0 : Math.min(1, (x - startX) / fadeWidth);
      const eased = Math.pow(t, 1.7);

      pixels[offset] = 0;
      pixels[offset + 1] = 0;
      pixels[offset + 2] = 0;
      pixels[offset + 3] = Math.round(255 * maxAlpha * eased);
    }
  }

  mkdirSync(dirname(filePath), { recursive: true });
  await sharp(pixels, {
    raw: {
      width,
      height,
      channels: 4
    }
  })
    .png()
    .toFile(filePath);
}

function fillRect(buffer, width, x, y, rectWidth, rectHeight, red, green, blue, alpha) {
  const startX = Math.max(0, Math.floor(x));
  const startY = Math.max(0, Math.floor(y));
  const endX = Math.min(width, Math.ceil(x + rectWidth));
  const endY = Math.min(buffer.length / width / 4, Math.ceil(y + rectHeight));

  for (let py = startY; py < endY; py += 1) {
    for (let px = startX; px < endX; px += 1) {
      const offset = (py * width + px) * 4;
      buffer[offset] = red;
      buffer[offset + 1] = green;
      buffer[offset + 2] = blue;
      buffer[offset + 3] = alpha;
    }
  }
}

function buildBands(count, lowFrequency, highFrequency) {
  return Array.from({ length: count }, (_, index) => {
    const t = index / Math.max(1, count - 1);
    return lowFrequency * Math.pow(highFrequency / lowFrequency, t);
  });
}

function onceDrain(stream) {
  return new Promise((resolvePromise) => {
    stream.once("drain", resolvePromise);
  });
}

function waitForProcess(childProcess) {
  return new Promise((resolvePromise, rejectPromise) => {
    childProcess.once("error", rejectPromise);
    childProcess.once("close", resolvePromise);
  });
}

function findSceneImage(directory, track) {
  const baseName = `${String(track.track_index).padStart(2, "0")}-${slugify(track.title)}`;
  const candidates = [
    join(directory, `${baseName}.png`),
    join(directory, `${baseName}.jpg`),
    join(directory, `${baseName}.jpeg`),
    join(directory, `${String(track.track_index).padStart(2, "0")}.png`)
  ];
  const found = candidates.find((candidate) => existsSync(candidate));

  if (!found) {
    throw new Error(`Missing scene image for track ${track.track_index}. Tried: ${candidates.join(", ")}`);
  }

  return found;
}

function probeDurationSeconds(filePath) {
  const output = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nk=1:nw=1",
      filePath
    ],
    { encoding: "utf8" }
  ).trim();
  const durationSeconds = Number(output);

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`Invalid duration from ffprobe for ${filePath}: ${output}`);
  }

  return durationSeconds;
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

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readPositiveIntArg(name, fallback) {
  const value = readArg(name);

  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function readOptionalPositiveNumberArg(name) {
  const value = readArg(name);

  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }

  return parsed;
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

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function replaceExtension(filePath, extension) {
  return filePath.replace(/\.[^.\\/]+$/, extension);
}
