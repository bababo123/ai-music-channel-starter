import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type pino from "pino";
import type { AssetRepository } from "../repositories/asset-repository";
import type {
  PublishAssetRow,
  PublishEpisodeRow,
  PublishPackageRepository,
  PublishTrackRow
} from "../repositories/publish-package-repository";
import type { TrackRepository } from "../repositories/track-repository";
import { slugify } from "../utils/slug";

const execFileAsync = promisify(execFile);

export type YoutubePublishPackageOptions = {
  episodeId: string;
  videoPath?: string;
  visibility?: "private" | "unlisted" | "public";
  scheduledPublishAt?: string;
};

type Chapter = {
  timestamp: string;
  startSeconds: number;
  title: string;
  trackIndex: number;
};

export class YoutubePublishPackageService {
  constructor(
    private readonly publishRepository: PublishPackageRepository,
    private readonly trackRepository: TrackRepository,
    private readonly assetRepository: AssetRepository,
    private readonly logger: pino.Logger
  ) {}

  async createPackage(options: YoutubePublishPackageOptions) {
    const episode = this.publishRepository.getEpisode(options.episodeId);

    if (!episode) {
      throw new Error(`Episode not found: ${options.episodeId}`);
    }

    const tracks = this.publishRepository.listTracks(options.episodeId);
    const assets = this.publishRepository.listAssets(options.episodeId);
    const assetMap = buildAssetMap(assets);
    const thumbnail = assetMap.get("thumbnail_final");
    const finalAudio = assetMap.get("final_audio_mix");
    const preview = assetMap.get("audio_preview");
    const videoPath = resolveVideoPath(episode, options.videoPath);
    const probedVideo = videoPath ? await probeMedia(videoPath) : undefined;
    const finalAudioDuration = readNumber(finalAudio?.metadata.durationSeconds);
    const durationSeconds = probedVideo?.durationSeconds ?? finalAudioDuration ?? estimateDuration(tracks);
    const chapters = buildChapters(tracks, readNumber(finalAudio?.metadata.crossfadeSeconds) ?? 5);
    const title = normalizeTitle(episode.title);
    const hashtags = buildHashtags(episode);
    const description = buildDescription({
      episode,
      chapters,
      durationSeconds,
      aiDisclosureNote: "AI-assisted music and visual assets; human-curated, mixed, rendered, and reviewed.",
      hashtags
    });
    const tags = fitTags(buildTags(episode));
    const pinnedComment = `What are you working on tonight? If this helped you focus, leave your task below and return to this session whenever you need a quiet reset.`;
    const packageAssets = {
      ...(videoPath ? { videoPath } : {}),
      ...(thumbnail?.filePath ? { thumbnailPath: thumbnail.filePath } : {}),
      ...(finalAudio?.filePath ? { finalAudioPath: finalAudio.filePath } : {}),
      ...(preview?.filePath ? { previewPath: preview.filePath } : {})
    };
    const uploadChecklist = buildUploadChecklist({
      hasVideo: Boolean(videoPath),
      hasThumbnail: Boolean(thumbnail?.filePath),
      hasAudio: Boolean(finalAudio?.filePath),
      visibility: options.visibility ?? "private",
      playlistName: episode.plan.seriesName
    });

    const publishDir = join(episode.outputDir, "publish");
    mkdirSync(publishDir, { recursive: true });
    const markdownPath = join(publishDir, "youtube-package.md");
    const jsonPath = join(publishDir, "youtube-package.json");

    const metadata = {
      episodeId: episode.id,
      series: episode.plan.seriesName,
      subtitle: episode.subtitle,
      status: "needs_approval",
      visibility: options.visibility ?? "private",
      ...(options.scheduledPublishAt ? { scheduledPublishAt: options.scheduledPublishAt } : {}),
      title,
      description,
      chapters,
      tags,
      hashtags,
      pinnedComment,
      uploadChecklist,
      assets: packageAssets,
      durationSeconds,
      videoProbe: probedVideo,
      notes: [
        "Set YouTube Studio altered/synthetic content disclosure to Yes for AI-generated music.",
        "Do not upload until final human approve is complete."
      ]
    };

    await writeFile(jsonPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    await writeFile(markdownPath, renderMarkdown(metadata), "utf8");

    this.assetRepository.saveAsset({
      id: `${episode.id}-youtube-publish-package`,
      episodeId: episode.id,
      assetType: "youtube_publish_package",
      provider: "local",
      prompt: "Programmatic YouTube metadata and manual approval package.",
      filePath: markdownPath,
      status: "needs_approval",
      metadata: {
        jsonPath,
        videoPath,
        thumbnailPath: thumbnail?.filePath,
        title,
        durationSeconds
      }
    });
    this.trackRepository.markEpisodeStatus(episode.id, "needs_approval");
    this.logger.info({ episodeId: episode.id, markdownPath }, "Created YouTube publish package");

    return {
      episodeId: episode.id,
      status: "needs_approval",
      title,
      markdownPath,
      jsonPath,
      videoPath,
      thumbnailPath: thumbnail?.filePath,
      durationSeconds
    };
  }
}

function buildAssetMap(assets: PublishAssetRow[]) {
  const map = new Map<string, PublishAssetRow>();

  for (const asset of assets) {
    map.set(asset.assetType, asset);
  }

  return map;
}

function resolveVideoPath(episode: PublishEpisodeRow, explicitPath?: string) {
  if (explicitPath) {
    return resolve(explicitPath);
  }

  const rendersDir = resolve("video", "renders");

  if (!existsSync(rendersDir)) {
    return undefined;
  }

  const seriesSlug = slugify(episode.plan.seriesName);
  const matches = readdirSync(rendersDir)
    .filter((name) => name.toLowerCase().endsWith(".mp4"))
    .map((name) => {
      const filePath = join(rendersDir, name);
      return { name, filePath, mtimeMs: statSync(filePath).mtimeMs };
    })
    .filter((file) => file.name.includes(episode.seriesId) || file.name.includes(seriesSlug))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  return matches[0]?.filePath;
}

async function probeMedia(filePath: string) {
  if (!existsSync(filePath)) {
    return undefined;
  }

  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration,size,bit_rate",
    "-of",
    "json",
    filePath
  ]);
  const parsed = JSON.parse(stdout) as {
    format?: {
      duration?: string;
      size?: string;
      bit_rate?: string;
    };
  };

  return {
    durationSeconds: parsed.format?.duration ? Number(parsed.format.duration) : undefined,
    sizeBytes: parsed.format?.size ? Number(parsed.format.size) : undefined,
    bitRate: parsed.format?.bit_rate ? Number(parsed.format.bit_rate) : undefined
  };
}

function buildChapters(tracks: PublishTrackRow[], crossfadeSeconds: number): Chapter[] {
  let elapsed = 0;

  return tracks.map((track, index) => {
    const startSeconds = Math.max(0, Math.round(elapsed));
    const chapter = {
      timestamp: formatTimestamp(startSeconds),
      startSeconds,
      title: track.title,
      trackIndex: track.trackIndex
    };
    const durationSeconds = track.durationSeconds ?? track.durationTargetSeconds;

    if (index < tracks.length - 1) {
      elapsed += Math.max(0, durationSeconds - crossfadeSeconds);
    }

    return chapter;
  });
}

function buildDescription(input: {
  episode: PublishEpisodeRow;
  chapters: Chapter[];
  durationSeconds: number;
  aiDisclosureNote: string;
  hashtags: string[];
}) {
  const useCases = input.episode.plan.metadata.tags
    .map((tag) => tag.replace(/\s+music$/i, ""))
    .filter(
      (tag) =>
        tag.toLowerCase() !== input.episode.plan.seriesName.toLowerCase() &&
        tag.toLowerCase() !== input.episode.subtitle.toLowerCase()
    )
    .filter((tag) => /coding|focus|study|deep work|writing/i.test(tag))
    .slice(0, 4);

  return [
    `${input.episode.subtitle} is a ${input.episode.plan.seriesName} session for ${joinHumanList(
      useCases.length > 0 ? useCases : ["deep work", "coding", "study", "late-night focus"]
    )}.`,
    "",
    "Quiet cinematic ambient textures meet a restrained lo-fi undercurrent: soft pads, warm keys, muted bass, and low-volume dusty drums that stay supportive instead of demanding attention.",
    "",
    `Runtime: ${formatRuntime(input.durationSeconds)}`,
    "",
    "Chapters:",
    input.chapters.map((chapter) => `${chapter.timestamp} ${chapter.title}`).join("\n"),
    "",
    input.aiDisclosureNote,
    "",
    input.hashtags.join(" ")
  ].join("\n");
}

function buildTags(episode: PublishEpisodeRow) {
  return uniqueStrings([
    episode.plan.seriesName,
    episode.subtitle,
    "deep work music",
    "coding music",
    "focus music",
    "ambient music",
    "cinematic ambient",
    "lofi ambient",
    "lofi coding music",
    "study music",
    "work music",
    "background music for coding",
    "music for concentration",
    ...episode.plan.metadata.tags
  ]);
}

function buildHashtags(episode: PublishEpisodeRow) {
  return uniqueStrings([
    `#${episode.plan.seriesName.replace(/[^a-zA-Z0-9]+/g, "")}`,
    "#DeepWork",
    "#CodingMusic",
    "#FocusMusic",
    "#AmbientMusic"
  ]);
}

function fitTags(tags: string[]) {
  const result: string[] = [];
  let totalLength = 0;

  for (const tag of tags) {
    const nextLength = totalLength + tag.length + (result.length > 0 ? 1 : 0);

    if (nextLength > 450) {
      break;
    }

    result.push(tag);
    totalLength = nextLength;
  }

  return result;
}

function buildUploadChecklist(input: {
  hasVideo: boolean;
  hasThumbnail: boolean;
  hasAudio: boolean;
  visibility: string;
  playlistName: string;
}) {
  return [
    `${input.hasVideo ? "OK" : "MISSING"} final MP4 is present.`,
    `${input.hasThumbnail ? "OK" : "MISSING"} final thumbnail is present.`,
    `${input.hasAudio ? "OK" : "MISSING"} final mixed audio is present.`,
    "Listen to the first 30 seconds at normal YouTube listening volume.",
    "Spot-check 15, 30, and 50 minute marks for distracting high-frequency sounds.",
    "Confirm thumbnail text only contains the series name.",
    "Paste title, description, chapters, tags, and pinned comment.",
    `Set visibility to ${input.visibility}.`,
    `Set playlist to ${input.playlistName}.`,
    "Set Made for Kids to No.",
    "Set altered/synthetic content disclosure to Yes.",
    "Wait for YouTube processing and copyright checks before approving publish."
  ];
}

function renderMarkdown(metadata: {
  episodeId: string;
  series: string;
  subtitle: string;
  status: string;
  visibility: string;
  scheduledPublishAt?: string;
  title: string;
  description: string;
  chapters: Chapter[];
  tags: string[];
  hashtags: string[];
  pinnedComment: string;
  uploadChecklist: string[];
  assets: {
    videoPath?: string;
    thumbnailPath?: string;
    finalAudioPath?: string;
    previewPath?: string;
  };
  durationSeconds: number;
}) {
  return [
    "# YouTube Publish Package",
    "",
    `Episode ID: ${metadata.episodeId}`,
    `Series: ${metadata.series}`,
    `Subtitle: ${metadata.subtitle}`,
    `Status: ${metadata.status}`,
    `Visibility: ${metadata.visibility}`,
    ...(metadata.scheduledPublishAt ? [`Scheduled publish at: ${metadata.scheduledPublishAt}`] : []),
    `Runtime: ${formatRuntime(metadata.durationSeconds)}`,
    "",
    "## Assets",
    "",
    `- Final video: ${metadata.assets.videoPath ?? "MISSING"}`,
    `- Thumbnail: ${metadata.assets.thumbnailPath ?? "MISSING"}`,
    `- Final audio: ${metadata.assets.finalAudioPath ?? "MISSING"}`,
    `- 60s preview: ${metadata.assets.previewPath ?? "MISSING"}`,
    "",
    "## Title",
    "",
    metadata.title,
    "",
    "## Description",
    "",
    "```text",
    metadata.description,
    "```",
    "",
    "## Chapters",
    "",
    "```text",
    metadata.chapters.map((chapter) => `${chapter.timestamp} ${chapter.title}`).join("\n"),
    "```",
    "",
    "## Tags",
    "",
    "```text",
    metadata.tags.join(", "),
    "```",
    "",
    "## Hashtags",
    "",
    metadata.hashtags.join(" "),
    "",
    "## Pinned Comment",
    "",
    metadata.pinnedComment,
    "",
    "## Upload Checklist",
    "",
    ...metadata.uploadChecklist.map((item) => `- [ ] ${item}`),
    ""
  ].join("\n");
}

function normalizeTitle(title: string) {
  if (title.length <= 100) {
    return title;
  }

  return title
    .replace(" Music for Deep Work, Coding & Focus", " for Deep Work, Coding & Focus")
    .slice(0, 100)
    .trim();
}

function estimateDuration(tracks: PublishTrackRow[]) {
  return tracks.reduce((total, track) => total + (track.durationSeconds ?? track.durationTargetSeconds), 0);
}

function formatTimestamp(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatRuntime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function joinHumanList(items: string[]) {
  if (items.length <= 1) {
    return items[0] ?? "";
  }

  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    const key = normalized.toLowerCase();

    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
