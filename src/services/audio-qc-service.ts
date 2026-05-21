import { access, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type pino from "pino";
import { z } from "zod";
import type { AudioTrackRow, TrackRepository } from "../repositories/track-repository";

const execFileAsync = promisify(execFile);

const ffprobeSchema = z.object({
  streams: z
    .array(
      z.object({
        codec_name: z.string().optional(),
        sample_rate: z.string().optional(),
        channels: z.number().optional()
      })
    )
    .default([]),
  format: z.object({
    duration: z.string().optional(),
    bit_rate: z.string().optional()
  })
});

export type AudioQcOptions = {
  episodeId: string;
  trackIndex?: number;
};

export class AudioQcService {
  constructor(
    private readonly trackRepository: TrackRepository,
    private readonly logger: pino.Logger
  ) {}

  async runEpisodeTrackQc(options: AudioQcOptions) {
    const episode = this.trackRepository.getEpisode(options.episodeId);

    if (!episode) {
      throw new Error(`Episode not found: ${options.episodeId}`);
    }

    const tracks = this.trackRepository.listAudioTracksForQc(
      options.episodeId,
      options.trackIndex
    );

    if (tracks.length === 0) {
      return {
        episodeId: options.episodeId,
        checked: 0,
        passed: 0,
        failed: 0,
        results: []
      };
    }

    const results = [];

    for (const track of tracks) {
      this.logger.info(
        { episodeId: options.episodeId, trackIndex: track.trackIndex, filePath: track.filePath },
        "Running audio QC"
      );

      const result = await this.checkTrack(track);
      this.trackRepository.saveTrackQcResult({
        episodeId: options.episodeId,
        trackId: track.id,
        passed: result.passed,
        checks: result.checks,
        notes: result.notes
      });
      results.push({
        trackIndex: track.trackIndex,
        title: track.title,
        passed: result.passed,
        notes: result.notes,
        durationSeconds: result.checks.durationSeconds,
        peakDb: result.checks.peakDb,
        meanDb: result.checks.meanDb
      });
    }

    return {
      episodeId: options.episodeId,
      checked: results.length,
      passed: results.filter((result) => result.passed).length,
      failed: results.filter((result) => !result.passed).length,
      results
    };
  }

  private async checkTrack(track: AudioTrackRow) {
    const failures: string[] = [];
    const warnings: string[] = [];
    const checks: Record<string, unknown> = {
      filePath: track.filePath
    };

    try {
      await access(track.filePath);
      const fileStats = await stat(track.filePath);
      checks.sizeBytes = fileStats.size;

      if (fileStats.size < 100_000) {
        failures.push("File is unexpectedly small.");
      }
    } catch {
      failures.push("File is missing or unreadable.");
      checks.failures = failures;
      checks.warnings = warnings;
      return {
        passed: false,
        checks,
        notes: failures.join(" ")
      };
    }

    const probe = await this.probe(track.filePath);
    checks.durationSeconds = probe.durationSeconds;
    checks.bitRate = probe.bitRate;
    checks.codec = probe.codec;
    checks.sampleRate = probe.sampleRate;
    checks.channels = probe.channels;

    if (!probe.durationSeconds || probe.durationSeconds < 90) {
      failures.push("Duration is below the 90 second minimum.");
    }

    if (probe.sampleRate !== 44100) {
      failures.push("Sample rate is not 44100 Hz.");
    }

    if (probe.channels !== 2) {
      failures.push("Audio is not stereo.");
    }

    const volume = await this.measureVolume(track.filePath);
    checks.meanDb = volume.meanDb;
    checks.peakDb = volume.peakDb;

    if (volume.meanDb !== undefined && volume.meanDb < -45) {
      failures.push("Mean volume is too low and may be near-silent.");
    }

    if (volume.peakDb !== undefined && volume.peakDb > -0.1) {
      warnings.push("Peak volume is close to clipping; final mix should normalize headroom.");
    }

    checks.failures = failures;
    checks.warnings = warnings;

    return {
      passed: failures.length === 0,
      checks,
      notes:
        failures.length > 0
          ? failures.join(" ")
          : warnings.length > 0
            ? `Minimum audio QC passed with warnings: ${warnings.join(" ")}`
            : "Minimum audio QC passed."
    };
  }

  private async probe(filePath: string) {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration,bit_rate",
      "-show_entries",
      "stream=codec_name,sample_rate,channels",
      "-of",
      "json",
      filePath
    ]);
    const parsed = ffprobeSchema.parse(JSON.parse(stdout) as unknown);
    const stream = parsed.streams[0];

    return {
      durationSeconds: parsed.format.duration ? Number(parsed.format.duration) : undefined,
      bitRate: parsed.format.bit_rate ? Number(parsed.format.bit_rate) : undefined,
      codec: stream?.codec_name,
      sampleRate: stream?.sample_rate ? Number(stream.sample_rate) : undefined,
      channels: stream?.channels
    };
  }

  private async measureVolume(filePath: string) {
    const nullOutput = process.platform === "win32" ? "NUL" : "/dev/null";

    try {
      const { stdout, stderr } = await execFileAsync("ffmpeg", [
        "-hide_banner",
        "-nostats",
        "-i",
        filePath,
        "-af",
        "volumedetect",
        "-f",
        "null",
        nullOutput
      ]);
      const output = `${stdout}\n${stderr}`;

      return {
        meanDb: parseVolume(output, "mean_volume"),
        peakDb: parseVolume(output, "max_volume")
      };
    } catch (error) {
      const stderr = getProcessStderr(error);
      const stdout = getProcessStdout(error);
      const output = `${stdout}\n${stderr}`;

      return {
        meanDb: parseVolume(output, "mean_volume"),
        peakDb: parseVolume(output, "max_volume")
      };
    }
  }
}

function parseVolume(output: string, label: "mean_volume" | "max_volume") {
  const match = output.match(new RegExp(`${label}:\\s*(-?\\d+(?:\\.\\d+)?)\\s*dB`));

  return match ? Number(match[1]) : undefined;
}

function getProcessStderr(error: unknown) {
  if (typeof error === "object" && error && "stderr" in error) {
    return String((error as { stderr?: unknown }).stderr ?? "");
  }

  return "";
}

function getProcessStdout(error: unknown) {
  if (typeof error === "object" && error && "stdout" in error) {
    return String((error as { stdout?: unknown }).stdout ?? "");
  }

  return "";
}
