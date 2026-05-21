export type MusicGenerationInput = {
  prompt: string;
  outputPath: string;
  trackTitle: string;
  trackIndex: number;
};

export type MusicGenerationResult = {
  provider: string;
  model: string;
  traceId?: string;
  sourceUrl?: string;
  filePath: string;
  durationSeconds?: number;
  sampleRate?: number;
  bitrate?: number;
  channels?: number;
  sizeBytes: number;
  sha256: string;
  rawResponse: unknown;
};

export interface MusicProvider {
  readonly id: string;
  readonly model: string;
  generateTrack(input: MusicGenerationInput): Promise<MusicGenerationResult>;
}
