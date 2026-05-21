export type ImageGenerationInput = {
  prompt: string;
};

export type ImageGenerationResult = {
  provider: string;
  model: string;
  fileExtension: "png" | "jpeg" | "webp";
  bytes: Buffer;
  rawResponse: unknown;
};

export interface ImageProvider {
  readonly id: string;
  readonly model: string;
  readonly fileExtension: "png" | "jpeg" | "webp";
  generateImage(input: ImageGenerationInput): Promise<ImageGenerationResult>;
}
