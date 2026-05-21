import OpenAI from "openai";
import type { ImageGenerateParams } from "openai/resources/images";
import type {
  ImageGenerationInput,
  ImageGenerationResult,
  ImageProvider
} from "../domain/image-provider";

export type OpenAIImageProviderOptions = {
  apiKey: string;
  model: "gpt-image-1.5" | "gpt-image-1" | "gpt-image-1-mini";
  size: "1024x1024" | "1536x1024" | "1024x1536" | "auto";
  quality: "low" | "medium" | "high" | "auto";
  outputFormat: "png" | "jpeg" | "webp";
};

export class OpenAIImageProvider implements ImageProvider {
  readonly id = "openai";
  readonly model: OpenAIImageProviderOptions["model"];
  readonly fileExtension: OpenAIImageProviderOptions["outputFormat"];
  private readonly client: OpenAI;

  constructor(private readonly options: OpenAIImageProviderOptions) {
    this.client = new OpenAI({ apiKey: options.apiKey });
    this.model = options.model;
    this.fileExtension = options.outputFormat;
  }

  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    const response = await this.client.images.generate({
      model: this.options.model,
      prompt: input.prompt,
      n: 1,
      size: this.options.size,
      quality: this.options.quality,
      output_format: this.options.outputFormat
    } satisfies ImageGenerateParams);

    const b64Json = response.data?.[0]?.b64_json;

    if (!b64Json) {
      throw new Error("OpenAI image response did not include data[0].b64_json.");
    }

    return {
      provider: this.id,
      model: this.options.model,
      fileExtension: this.options.outputFormat,
      bytes: Buffer.from(b64Json, "base64"),
      rawResponse: response
    };
  }
}
