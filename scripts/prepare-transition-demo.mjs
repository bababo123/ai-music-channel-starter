import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import Database from "better-sqlite3";

const episodeId = readArg("--episode-id") ?? "2026-05-07-lunar-night-shift-silent-crater-relay";
const trackIndexes = (readArg("--tracks") ?? "1,3,4").split(",").map((value) => Number(value.trim()));
const segmentSeconds = Number(readArg("--segment-seconds") ?? 32);
const crossfadeSeconds = Number(readArg("--crossfade-seconds") ?? 3);
const demoDuration = segmentSeconds * trackIndexes.length - crossfadeSeconds * (trackIndexes.length - 1);

if (trackIndexes.length !== 3 || trackIndexes.some((value) => !Number.isInteger(value))) {
  throw new Error("Use exactly 3 track indexes, for example: --tracks 1,3,4");
}

const db = new Database(resolve("data", "music-channel.sqlite"));
const episode = db
  .prepare("SELECT id, subtitle, thumbnail_text FROM episodes WHERE id = ?")
  .get(episodeId);

if (!episode) {
  throw new Error(`Episode not found: ${episodeId}`);
}

const tracks = db
  .prepare(
    `
SELECT track_index, title, file_path, duration_seconds
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

const selectedTracks = trackIndexes.map((index) => {
  const track = tracks.find((candidate) => candidate.track_index === index);

  if (!track?.file_path) {
    throw new Error(`Track ${index} is missing a generated audio file`);
  }

  return track;
});
const hero = assets.find((asset) => asset.asset_type === "hero_image");

if (!hero?.file_path) {
  throw new Error(`Episode ${episodeId} is missing hero_image asset`);
}

const projectDir = resolve("video", "hyperframes-transition-demo");
const assetDir = join(projectDir, "assets", "episode");
rmSync(projectDir, { recursive: true, force: true });
mkdirSync(assetDir, { recursive: true });
copyFileSync(hero.file_path, join(assetDir, "hero-1920x1080.png"));

const audioPath = join(assetDir, "transition-demo-audio.mp3");
renderDemoAudio(selectedTracks, audioPath);
writeFileSync(join(projectDir, "package.json"), renderPackageJson(), "utf8");
writeFileSync(join(projectDir, "hyperframes.json"), renderHyperframesJson(), "utf8");
writeFileSync(join(projectDir, "meta.json"), JSON.stringify({ title: "Lunar Night Shift Transition Demo" }, null, 2), "utf8");
writeFileSync(join(projectDir, "index.html"), renderHtml({
  episode,
  tracks: selectedTracks,
  demoDuration,
  segmentSeconds,
  crossfadeSeconds
}), "utf8");

console.log(JSON.stringify({
  episodeId,
  projectDir,
  durationSeconds: demoDuration,
  transitionPreset: "lunar-soft-bloom",
  tracks: selectedTracks.map((track) => ({
    index: track.track_index,
    title: track.title,
    source: basename(track.file_path)
  }))
}, null, 2));

function renderDemoAudio(tracksForDemo, outputPath) {
  const inputs = tracksForDemo.flatMap((track) => ["-i", track.file_path]);
  const segments = tracksForDemo.map((track, index) => {
    const durationSeconds = Number(track.duration_seconds ?? segmentSeconds);
    const start = Math.max(0, Math.min(durationSeconds - segmentSeconds - 1, durationSeconds * 0.36));

    return `[${index}:a]atrim=start=${start.toFixed(3)}:duration=${segmentSeconds},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo[a${index}]`;
  });
  const filter = [
    ...segments,
    `[a0][a1]acrossfade=d=${crossfadeSeconds}:c1=tri:c2=tri[x1]`,
    `[x1][a2]acrossfade=d=${crossfadeSeconds}:c1=tri:c2=tri[aout]`
  ].join(";");

  execFileSync("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    ...inputs,
    "-filter_complex",
    filter,
    "-map",
    "[aout]",
    "-t",
    demoDuration.toFixed(3),
    "-c:a",
    "libmp3lame",
    "-b:a",
    "192k",
    outputPath
  ], { stdio: "inherit" });
}

function renderHtml(input) {
  const trackStarts = input.tracks.map((_, index) => index * (input.segmentSeconds - input.crossfadeSeconds));
  const transitions = trackStarts.slice(1).map((start, index) => ({
    start,
    from: input.tracks[index],
    to: input.tracks[index + 1]
  }));
  const duration = input.demoDuration.toFixed(3);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
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
        inset: -58px;
        width: calc(100% + 116px);
        height: calc(100% + 116px);
        object-fit: cover;
        transform-origin: 52% 46%;
        filter: saturate(0.9) contrast(1.05) brightness(0.86);
      }
      .vignette {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(circle at 66% 30%, rgba(135, 190, 255, 0.13), transparent 28%),
          radial-gradient(circle at 50% 48%, rgba(7, 13, 24, 0) 0%, rgba(7, 13, 24, 0.18) 56%, rgba(0, 0, 0, 0.62) 100%),
          linear-gradient(180deg, rgba(0, 0, 0, 0.2), rgba(0, 0, 0, 0.12) 46%, rgba(0, 0, 0, 0.44));
      }
      .grain {
        position: absolute;
        inset: 0;
        opacity: 0.11;
        mix-blend-mode: soft-light;
        background-image:
          linear-gradient(0deg, rgba(255,255,255,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
        background-size: 7px 7px, 11px 11px;
      }
      .transition-bloom {
        position: absolute;
        inset: -160px;
        opacity: 0;
        mix-blend-mode: screen;
        background:
          radial-gradient(circle at 66% 31%, rgba(210,232,255,0.62) 0%, rgba(136,189,255,0.22) 19%, rgba(82,128,190,0.08) 34%, transparent 50%),
          radial-gradient(circle at 50% 51%, rgba(220,235,255,0.14), transparent 42%);
        filter: blur(22px);
      }
      .star-veil {
        position: absolute;
        inset: -80px;
        opacity: 0;
        mix-blend-mode: screen;
        background-image:
          radial-gradient(circle, rgba(235,245,255,0.52) 0 1px, transparent 1.6px),
          radial-gradient(circle, rgba(140,185,240,0.32) 0 1px, transparent 1.4px);
        background-size: 86px 86px, 139px 139px;
        filter: blur(0.4px);
      }
      .horizon-sweep {
        position: absolute;
        left: 0;
        right: 0;
        top: 612px;
        height: 2px;
        opacity: 0;
        background: linear-gradient(90deg, transparent, rgba(198,226,255,0.78), transparent);
        box-shadow: 0 0 30px rgba(135,190,255,0.42);
        transform: translateX(-34%);
      }
      .title-block {
        position: absolute;
        left: 88px;
        bottom: 92px;
        color: #f4f7fb;
        opacity: 0;
        text-shadow: 0 18px 60px rgba(0, 0, 0, 0.58);
      }
      .series {
        font-size: 54px;
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
        max-width: 760px;
        color: #dce8f5;
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
      .transition-label {
        position: absolute;
        left: 88px;
        top: 88px;
        opacity: 0;
        color: rgba(219,232,248,0.86);
        text-shadow: 0 10px 40px rgba(0,0,0,0.46);
      }
      .transition-label .kicker {
        font-size: 16px;
        color: rgba(152,169,187,0.88);
        margin-bottom: 10px;
        letter-spacing: 0;
      }
      .transition-label .name {
        font-size: 26px;
        font-weight: 700;
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
      <img id="bg" class="background clip" data-start="0" data-duration="${duration}" data-track-index="0" src="assets/episode/hero-1920x1080.png" />
      <div id="vignette" class="vignette clip" data-start="0" data-duration="${duration}" data-track-index="1"></div>
      <div id="grain" class="grain clip" data-start="0" data-duration="${duration}" data-track-index="2"></div>
      <div id="bloom" class="transition-bloom clip" data-start="0" data-duration="${duration}" data-track-index="3"></div>
      <div id="veil" class="star-veil clip" data-start="0" data-duration="${duration}" data-track-index="4"></div>
      <div id="sweep" class="horizon-sweep clip" data-start="0" data-duration="${duration}" data-track-index="5"></div>

      <div id="title" class="title-block clip" data-start="0" data-duration="13" data-track-index="6">
        <div class="series">${escapeHtml(input.episode.thumbnail_text)}</div>
        <div class="subtitle">Transition study - ${escapeHtml(input.episode.subtitle)}</div>
      </div>

${input.tracks.map((track, index) => renderChapter(track, index, trackStarts[index])).join("\n")}
${transitions.map((transition, index) => renderTransitionLabel(transition, index)).join("\n")}

      <audio id="demo-audio" data-start="0" data-duration="${duration}" data-track-index="20" data-volume="1" src="assets/episode/transition-demo-audio.mp3"></audio>
    </div>

    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      const transitionStarts = ${JSON.stringify(transitions.map((transition) => Number(transition.start.toFixed(3))))};

      tl.fromTo("#bg", { scale: 1.048, x: -12, y: -10 }, { scale: 1.085, x: 10, y: 8, duration: ${duration}, ease: "none" }, 0);
      tl.fromTo("#grain", { opacity: 0.08 }, { opacity: 0.15, duration: 18, yoyo: true, repeat: 5, ease: "sine.inOut" }, 0);
      tl.fromTo("#title", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 1.6, ease: "power2.out" }, 1);
      tl.to("#title", { opacity: 0, y: -8, duration: 1.8, ease: "power2.inOut" }, 10.8);

      document.querySelectorAll(".chapter").forEach((chapter) => {
        const start = Number(chapter.dataset.start || 0);
        tl.fromTo(chapter, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 1.4, ease: "power2.out" }, start + 0.6);
        tl.to(chapter, { opacity: 0, y: -8, duration: 1.5, ease: "power2.inOut" }, start + 7.3);
      });

      transitionStarts.forEach((start, index) => {
        const at = start - 1.45;
        tl.fromTo("#bloom", { opacity: 0, scale: 0.96 }, { opacity: 0.72, scale: 1.03, duration: 1.45, ease: "sine.out", overwrite: "auto" }, at);
        tl.to("#bloom", { opacity: 0, scale: 1.08, duration: 2.15, ease: "sine.inOut", overwrite: "auto" }, start + 0.12);
        tl.fromTo("#veil", { opacity: 0, x: -28, y: 12 }, { opacity: 0.24, x: 8, y: -4, duration: 2.1, ease: "sine.out", overwrite: "auto" }, at + 0.15);
        tl.to("#veil", { opacity: 0, x: 42, y: -12, duration: 2.1, ease: "sine.inOut", overwrite: "auto" }, start + 0.6);
        tl.fromTo("#sweep", { opacity: 0, x: "-34%" }, { opacity: 0.68, x: "0%", duration: 1.5, ease: "power2.out", overwrite: "auto" }, at + 0.35);
        tl.to("#sweep", { opacity: 0, x: "34%", duration: 1.5, ease: "power2.inOut", overwrite: "auto" }, start + 0.45);
        tl.to("#bg", { scale: "+=0.012", filter: "saturate(0.95) contrast(1.08) brightness(0.96)", duration: 1.35, ease: "sine.out", overwrite: "auto" }, at + 0.25);
        tl.to("#bg", { filter: "saturate(0.9) contrast(1.05) brightness(0.86)", duration: 2.2, ease: "sine.inOut", overwrite: "auto" }, start + 0.3);
        tl.fromTo("#transition-" + index, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 1, ease: "power2.out" }, at + 0.7);
        tl.to("#transition-" + index, { opacity: 0, y: -7, duration: 1.15, ease: "power2.inOut" }, start + 1.7);
      });

      tl.to("#root", { opacity: 0, duration: 4, ease: "power1.inOut" }, ${Math.max(0, input.demoDuration - 4).toFixed(3)});
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
}

function renderChapter(track, index, start) {
  return `      <div id="chapter-${index + 1}" class="chapter clip" data-start="${start.toFixed(3)}" data-duration="9" data-track-index="${7 + index}">
        <div class="chapter-number">${String(track.track_index).padStart(2, "0")}</div>
        <div class="chapter-title">${escapeHtml(track.title)}</div>
      </div>`;
}

function renderTransitionLabel(transition, index) {
  return `      <div id="transition-${index}" class="transition-label clip" data-start="${(transition.start - 1.4).toFixed(3)}" data-duration="4.8" data-track-index="${12 + index}">
        <div class="kicker">SOFT LUNAR BLOOM</div>
        <div class="name">${escapeHtml(transition.from.title)} -> ${escapeHtml(transition.to.title)}</div>
      </div>`;
}

function renderPackageJson() {
  return JSON.stringify({
    name: "hyperframes-transition-demo",
    private: true,
    type: "module",
    scripts: {
      dev: "npx --yes hyperframes@0.4.43 preview",
      check: "npx --yes hyperframes@0.4.43 lint && npx --yes hyperframes@0.4.43 validate && npx --yes hyperframes@0.4.43 inspect",
      render: "npx --yes hyperframes@0.4.43 render"
    }
  }, null, 2);
}

function renderHyperframesJson() {
  return JSON.stringify({
    $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
    registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
    paths: {
      blocks: "compositions",
      components: "compositions/components",
      assets: "assets"
    }
  }, null, 2);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
