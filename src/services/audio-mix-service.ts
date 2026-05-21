import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type pino from "pino";
import type { AssetRepository } from "../repositories/asset-repository";
import type { AudioTrackRow, TrackRepository } from "../repositories/track-repository";

const execFileAsync = promisify(execFile);

export type AudioMixOptions = {
  episodeId: string;
  allowPartial?: boolean;
  crossfadeSeconds?: number;
  previewSeconds?: number;
};

export class AudioMixService {
  constructor(
    private readonly trackRepository: TrackRepository,
    private readonly assetRepository: AssetRepository,
    private readonly logger: pino.Logger
  ) {}

  async mixEpisodeAudio(options: AudioMixOptions) {
    const episode = this.trackRepository.getEpisode(options.episodeId);

    if (!episode) {
      throw new Error(`Episode not found: ${options.episodeId}`);
    }

    const tracks = this.trackRepository.listAudioTracksForMix(options.episodeId);
    const totalTracks = this.trackRepository.countTracks(options.episodeId);

    if (tracks.length === 0) {
      throw new Error(`Episode ${options.episodeId} has no audio_qc_passed tracks to mix.`);
    }

    if (!options.allowPartial && tracks.length < totalTracks) {
      throw new Error(
        `Episode ${options.episodeId} has ${tracks.length}/${totalTracks} QC-passed tracks. Use --allow-partial for a test mix.`
      );
    }

    const isPartial = tracks.length < totalTracks;
    const crossfadeSeconds = options.crossfadeSeconds ?? 5;
    const previewSeconds = options.previewSeconds ?? 60;
    const mixDir = join(episode.outputDir, "audio", "mixes");
    mkdirSync(mixDir, { recursive: true });

    const finalAudioPath = join(
      mixDir,
      isPartial ? `partial-mix-${tracks.length}-tracks.mp3` : "final-mix.mp3"
    );
    const previewPath = join(
      mixDir,
      isPartial ? `partial-preview-${tracks.length}-tracks.mp3` : "preview-60s.mp3"
    );

    this.trackRepository.markEpisodeStatus(
      options.episodeId,
      isPartial ? "audio_partial_mixing" : "audio_mixing"
    );
    this.logger.info(
      { episodeId: options.episodeId, trackCount: tracks.length, finalAudioPath },
      "Mixing episode audio"
    );

    await this.renderMix({
      tracks,
      outputPath: finalAudioPath,
      crossfadeSeconds
    });
    await this.renderPreview(finalAudioPath, previewPath, previewSeconds);

    const finalProbe = await this.probeAudio(finalAudioPath);
    const previewProbe = await this.probeAudio(previewPath);
    const status = isPartial ? "audio_partial_ready" : "audio_ready";

    this.assetRepository.saveAsset({
      id: `${options.episodeId}-${isPartial ? "partial-audio-mix" : "final-audio-mix"}`,
      episodeId: options.episodeId,
      assetType: isPartial ? "partial_audio_mix" : "final_audio_mix",
      provider: "ffmpeg",
      filePath: finalAudioPath,
      status,
      metadata: {
        tracks: tracks.map((track) => ({
          id: track.id,
          trackIndex: track.trackIndex,
          title: track.title,
          filePath: track.filePath,
          durationSeconds: track.durationSeconds
        })),
        crossfadeSeconds,
        durationSeconds: finalProbe.durationSeconds,
        bitRate: finalProbe.bitRate,
        isPartial
      }
    });
    this.assetRepository.saveAsset({
      id: `${options.episodeId}-${isPartial ? "partial-audio-preview" : "audio-preview"}`,
      episodeId: options.episodeId,
      assetType: isPartial ? "partial_audio_preview" : "audio_preview",
      provider: "ffmpeg",
      filePath: previewPath,
      status,
      metadata: {
        sourcePath: finalAudioPath,
        requestedPreviewSeconds: previewSeconds,
        durationSeconds: previewProbe.durationSeconds,
        bitRate: previewProbe.bitRate,
        isPartial
      }
    });

    this.trackRepository.markEpisodeStatus(options.episodeId, status);

    return {
      episodeId: options.episodeId,
      status,
      isPartial,
      mixedTracks: tracks.length,
      totalTracks,
      finalAudioPath,
      previewPath,
      durationSeconds: finalProbe.durationSeconds,
      previewDurationSeconds: previewProbe.durationSeconds
    };
  }

  private async renderMix(input: {
    tracks: AudioTrackRow[];
    outputPath: string;
    crossfadeSeconds: number;
  }) {
    const args = ["-y", "-hide_banner", "-nostats"];

    for (const track of input.tracks) {
      args.push("-i", track.filePath);
    }

    args.push(
      "-filter_complex",
      buildMixFilter(input.tracks.length, input.crossfadeSeconds),
      "-map",
      "[aout]",
      "-ar",
      "44100",
      "-ac",
      "2",
      "-b:a",
      "256k",
      input.outputPath
    );

    await execFileAsync("ffmpeg", args, { maxBuffer: 1024 * 1024 * 20 });
  }

  private async renderPreview(sourcePath: string, previewPath: string, previewSeconds: number) {
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-nostats",
        "-i",
        sourcePath,
        "-t",
        String(previewSeconds),
        "-ar",
        "44100",
        "-ac",
        "2",
        "-b:a",
        "256k",
        previewPath
      ],
      { maxBuffer: 1024 * 1024 * 20 }
    );
  }

  private async probeAudio(filePath: string) {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration,bit_rate",
      "-of",
      "json",
      filePath
    ]);
    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string; bit_rate?: string };
    };

    return {
      durationSeconds: parsed.format?.duration ? Number(parsed.format.duration) : undefined,
      bitRate: parsed.format?.bit_rate ? Number(parsed.format.bit_rate) : undefined
    };
  }
}

function buildMixFilter(trackCount: number, crossfadeSeconds: number) {
  const formatFilter = "aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo";
  const inputFilters = Array.from(
    { length: trackCount },
    (_, index) => `[${index}:a]${formatFilter}[a${index}]`
  );

  if (trackCount === 1) {
    return `${inputFilters.join(";")};[a0]loudnorm=I=-16:LRA=11:TP=-1.5[aout]`;
  }

  const crossfades: string[] = [];
  let previousLabel = "a0";

  for (let index = 1; index < trackCount; index += 1) {
    const nextLabel = index === trackCount - 1 ? "xfinal" : `x${index}`;
    crossfades.push(
      `[${previousLabel}][a${index}]acrossfade=d=${crossfadeSeconds}:c1=tri:c2=tri[${nextLabel}]`
    );
    previousLabel = nextLabel;
  }

  return `${inputFilters.join(";")};${crossfades.join(";")};[xfinal]loudnorm=I=-16:LRA=11:TP=-1.5[aout]`;
}
