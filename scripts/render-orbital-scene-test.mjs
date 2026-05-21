import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import sharp from "sharp";

const defaultEpisodeId = "2026-05-19-orbital-systems-orbital-systems";
const episodeId = readArg("--episode-id") ?? defaultEpisodeId;
const trackCount = readPositiveIntArg("--track-count", 3);
const outputPath =
  readArg("--output") ??
  resolve("video", "renders", `${episodeId}-scene-test-${trackCount}-track.mp4`);
const sceneDir = readArg("--scene-dir") ?? resolve("outputs", episodeId, "images", "scenes");
const edgeShadePath =
  readArg("--edge-shade") ?? resolve("video", "renders", "assets", "edge-shade-right-20.png");
const telemetryOverlayPath =
  readArg("--telemetry-overlay") ??
  resolve("video", "renders", "assets", `${episodeId}-scene-test-${trackCount}-track-telemetry.mov`);
const fps = readPositiveIntArg("--fps", 24);
const audioCrossfadeSeconds = readPositiveNumberArg("--audio-crossfade", 5);
const videoFadeSeconds = readPositiveNumberArg("--video-fade", audioCrossfadeSeconds);
const durationCapSeconds = readOptionalPositiveNumberArg("--duration-cap");
const targetDurationSeconds = readOptionalPositiveNumberArg("--target-duration");

if (trackCount < 1) {
  throw new Error("--track-count must be at least 1");
}

if (Math.abs(videoFadeSeconds - audioCrossfadeSeconds) > 0.001) {
  throw new Error("--video-fade must match --audio-crossfade for this scene-test renderer");
}

const db = new Database(resolve("data", "music-channel.sqlite"));
const episode = db
  .prepare("SELECT id, series_id, subtitle, title, thumbnail_text FROM episodes WHERE id = ?")
  .get(episodeId);

if (!episode) {
  db.close();
  throw new Error(`Episode not found: ${episodeId}`);
}

const tracks = db
  .prepare(
    `
SELECT track_index, title, file_path, duration_seconds, duration_target_seconds
FROM tracks
WHERE episode_id = ?
ORDER BY track_index
LIMIT ?
`
  )
  .all(episodeId, trackCount);
db.close();

if (tracks.length !== trackCount) {
  throw new Error(`Expected ${trackCount} tracks, found ${tracks.length}`);
}

let scenes = tracks.map((track) => {
  if (!track.file_path || !existsSync(track.file_path)) {
    throw new Error(`Missing audio file for track ${track.track_index}: ${track.file_path ?? "(empty)"}`);
  }

  const imagePath = findSceneImage(sceneDir, track);
  const durationSeconds = probeDurationSeconds(track.file_path);

  return {
    trackIndex: track.track_index,
    title: track.title,
    audioPath: track.file_path,
    imagePath,
    durationSeconds
  };
});

scenes = padScenesToTargetDuration(scenes, {
  targetDurationSeconds,
  audioCrossfadeSeconds
});

const starts = buildSceneStarts(scenes, audioCrossfadeSeconds);
const totalDurationSeconds = starts.at(-1) + scenes.at(-1).durationSeconds;
const requestedDurationSeconds = targetDurationSeconds
  ? Math.min(targetDurationSeconds, totalDurationSeconds)
  : totalDurationSeconds;
const renderDurationSeconds = durationCapSeconds
  ? Math.min(durationCapSeconds, requestedDurationSeconds)
  : requestedDurationSeconds;

mkdirSync(dirname(outputPath), { recursive: true });
await ensureEdgeShade(edgeShadePath);

const telemetryAudio = renderTelemetryAudioMix({
  scenes,
  audioCrossfadeSeconds,
  renderDurationSeconds
});
let telemetry;

try {
  telemetry = analyzeAudio(telemetryAudio.outputPath, {
    fps,
    durationSeconds: renderDurationSeconds,
    bandCount: 50
  });
} finally {
  rmSync(telemetryAudio.tempDir, { recursive: true, force: true });
}

await renderTelemetryOverlay(telemetry, {
  outputPath: telemetryOverlayPath,
  fps,
  width: 1160,
  height: 58
});

const filter = buildFilter({
  episode,
  scenes,
  starts,
  edgeShadeIndex: scenes.length,
  telemetryIndex: scenes.length + 1,
  audioOffset: scenes.length + 2,
  fps,
  renderDurationSeconds,
  audioCrossfadeSeconds,
  videoFadeSeconds
});

const args = [
  "-y",
  "-hide_banner",
  ...scenes.flatMap((scene) => [
    "-loop",
    "1",
    "-framerate",
    String(fps),
    "-t",
    scene.durationSeconds.toFixed(3),
    "-i",
    scene.imagePath
  ]),
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
  ...scenes.flatMap((scene) => ["-i", scene.audioPath]),
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
  outputPath,
  sceneDir,
  edgeShadePath,
  telemetryOverlayPath,
  fps,
  audioCrossfadeSeconds,
  videoFadeSeconds,
  totalDurationSeconds,
  renderDurationSeconds,
  telemetry: {
    bandCount: telemetry.bandCount,
    barGap: 5,
    sampleRate: telemetry.sampleRate,
    windowSize: telemetry.windowSize
  },
  scenes: scenes.map((scene, index) => ({
    trackIndex: scene.trackIndex,
    title: scene.title,
    startSeconds: starts[index],
    durationSeconds: scene.durationSeconds,
    image: basename(scene.imagePath),
    audio: basename(scene.audioPath)
  }))
};

writeFileSync(replaceExtension(outputPath, ".json"), JSON.stringify(manifest, null, 2), "utf8");

console.log(JSON.stringify(manifest, null, 2));
execFileSync("ffmpeg", args, { stdio: "inherit" });

function buildFilter(input) {
  const filters = [];

  input.scenes.forEach((scene, index) => {
    const sceneFrames = Math.ceil(scene.durationSeconds * input.fps);
    const zoomEnd = 1.024 + index * 0.003;
    const zoomExpression = `1+${(zoomEnd - 1).toFixed(4)}*on/${sceneFrames}`;
    const pan = [
      { x0: 0.26, x1: 0.33, y0: 0.48, y1: 0.52 },
      { x0: 0.11, x1: 0.18, y0: 0.50, y1: 0.47 },
      { x0: 0.20, x1: 0.27, y0: 0.46, y1: 0.50 }
    ][index % 3];
    const progress = `on/${Math.max(1, sceneFrames - 1)}`;
    const xPosition = `iw/2-(iw/zoom/2)+(iw-iw/zoom)*((${pan.x0})+((${pan.x1})-(${pan.x0}))*${progress})`;
    const yPosition = `ih/2-(ih/zoom/2)+(ih-ih/zoom)*((${pan.y0})+((${pan.y1})-(${pan.y0}))*${progress})`;

    filters.push(
      `[${index}:v]scale=2240:1260:force_original_aspect_ratio=increase,crop=2240:1260,` +
        `zoompan=z='${zoomExpression}':` +
        `x='${xPosition}':` +
        `y='${yPosition}':` +
        `d=${sceneFrames}:s=1920x1080:fps=${input.fps},format=yuv420p[scene${index}]`
    );
  });

  let current = "scene0";
  let currentDurationSeconds = input.scenes[0].durationSeconds;
  for (let index = 1; index < input.scenes.length; index += 1) {
    const next = `xfade${index}`;
    const offsetSeconds = Math.max(0, currentDurationSeconds - input.videoFadeSeconds);
    filters.push(
      `[${current}][scene${index}]` +
        `xfade=transition=fade:duration=${input.videoFadeSeconds.toFixed(3)}:offset=${offsetSeconds.toFixed(3)}[${next}]`
    );
    current = next;
    currentDurationSeconds += input.scenes[index].durationSeconds - input.videoFadeSeconds;
  }

  filters.push(`[${current}]eq=contrast=1.025:saturation=0.96:brightness=0,format=yuv420p[vcolor]`);
  filters.push(`[${input.edgeShadeIndex}:v]format=rgba[edgeShade]`);
  filters.push(`[vcolor][edgeShade]overlay=shortest=1:format=auto,gradfun=strength=0.7:radius=16,format=yuv420p[vbase]`);
  filters.push(`[${input.telemetryIndex}:v]format=rgba[telemetry]`);
  filters.push(
    "[vbase][telemetry]overlay=x=(main_w-overlay_w)/2:y=main_h-116:shortest=1:format=auto[vtelemetry]"
  );

  current = "vtelemetry";
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
    text: getSeriesStrapline(input.episode),
    x: "88",
    y: "h-124",
    fontSize: 25,
    fontColor: "C9D6E5@0.92",
    enable: "between(t,1.0,14.6)"
  });

  input.scenes.forEach((scene, index) => {
    const start = (input.starts[index] + (index === 0 ? 0.7 : 0)).toFixed(3);
    const end = (
      index < input.scenes.length - 1
        ? input.starts[index + 1]
        : input.renderDurationSeconds
    ).toFixed(3);

    addDraw({
      text: String(scene.trackIndex).padStart(2, "0"),
      x: "w-tw-78",
      y: "h-130",
      fontSize: 18,
      fontColor: "98A9BB@0.92",
      enable: `between(t,${start},${end})`
    });
    addDraw({
      text: scene.title,
      x: "w-tw-78",
      y: "h-92",
      fontSize: 34,
      fontColor: "D8E4F0@0.96",
      font: "arialbd.ttf",
      enable: `between(t,${start},${end})`
    });
  });

  filters.push(
    `[${current}]fade=t=in:st=0:d=2,` +
      `fade=t=out:st=${Math.max(0, input.renderDurationSeconds - 8).toFixed(3)}:d=8[vout]`
  );

  filters.push(
    ...buildAudioFilters({
      scenes: input.scenes,
      audioOffset: input.audioOffset,
      audioCrossfadeSeconds: input.audioCrossfadeSeconds,
      outputLabel: "aout",
      prefix: "finalaud"
    })
  );

  return filters.join(";");
}

function renderTelemetryAudioMix(input) {
  const tempDir = mkdtempSync(join(tmpdir(), "orbital-scene-telemetry-audio-"));
  const outputPath = join(tempDir, "telemetry-mix.wav");
  const filters = buildAudioFilters({
    scenes: input.scenes,
    audioOffset: 0,
    audioCrossfadeSeconds: input.audioCrossfadeSeconds,
    outputLabel: "telemetryMix",
    prefix: "telemetryaud"
  });

  try {
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        ...input.scenes.flatMap((scene) => ["-i", scene.audioPath]),
        "-filter_complex",
        filters.join(";"),
        "-map",
        "[telemetryMix]",
        "-t",
        input.renderDurationSeconds.toFixed(3),
        "-ar",
        "48000",
        "-ac",
        "2",
        "-c:a",
        "pcm_s16le",
        outputPath
      ],
      { stdio: "inherit" }
    );

    return { tempDir, outputPath };
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function getSeriesStrapline(episode) {
  const seriesStraplines = {
    "orbital-systems": "Lofi for Coding | Orbital Systems",
    "deep-space-focus": "Lofi for Coding | Deep Space Focus",
    "midnight-terminal": "Lofi for Coding | Midnight Terminal Systems"
  };

  return seriesStraplines[episode.series_id] ?? "Lofi for Coding | Deep Focus Systems";
}

function buildAudioFilters(input) {
  if (input.scenes.length === 1) {
    return [
      `[${input.audioOffset}:a]aresample=48000,volume=0.74,alimiter=limit=0.74:level=false[${input.outputLabel}]`
    ];
  }

  const filters = [];
  let audioCurrent = `${input.audioOffset}:a`;

  for (let index = 1; index < input.scenes.length; index += 1) {
    const next = `${input.prefix}${index}`;
    filters.push(
      `[${audioCurrent}][${input.audioOffset + index}:a]` +
        `acrossfade=d=${input.audioCrossfadeSeconds.toFixed(3)}:c1=tri:c2=tri[${next}]`
    );
    audioCurrent = next;
  }

  filters.push(
    `[${audioCurrent}]aresample=48000,volume=0.74,alimiter=limit=0.74:level=false[${input.outputLabel}]`
  );

  return filters;
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
  return new Promise((resolvePromise, rejectPromise) => {
    const onDrain = () => {
      stream.off("error", onError);
      resolvePromise();
    };
    const onError = (error) => {
      stream.off("drain", onDrain);
      rejectPromise(error);
    };

    stream.once("drain", onDrain);
    stream.once("error", onError);
  });
}

function waitForProcess(process) {
  return new Promise((resolvePromise) => {
    process.once("close", resolvePromise);
  });
}

function padScenesToTargetDuration(scenes, options) {
  if (!options.targetDurationSeconds || scenes.length === 0) {
    return scenes;
  }

  const padded = [...scenes];
  const finalScene = scenes.at(-1);
  let starts = buildSceneStarts(padded, options.audioCrossfadeSeconds);
  let projectedDuration = starts.at(-1) + padded.at(-1).durationSeconds;

  while (projectedDuration < options.targetDurationSeconds) {
    padded.push({ ...finalScene });
    starts = buildSceneStarts(padded, options.audioCrossfadeSeconds);
    projectedDuration = starts.at(-1) + padded.at(-1).durationSeconds;
  }

  return padded;
}

function buildSceneStarts(scenes, crossfadeSeconds) {
  let elapsed = 0;

  return scenes.map((scene, index) => {
    const start = elapsed;

    if (index < scenes.length - 1) {
      elapsed += Math.max(0, scene.durationSeconds - crossfadeSeconds);
    }

    return start;
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

function readPositiveNumberArg(name, fallback) {
  const value = readArg(name);

  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
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
