import { mkdirSync } from "node:fs";
import { copyFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type pino from "pino";
import sharp from "sharp";
import type { EpisodePlan } from "../domain/episode-plan";
import type { ImageProvider } from "../domain/image-provider";
import type { AssetRepository } from "../repositories/asset-repository";
import type { EpisodePlanRepository } from "../repositories/episode-plan-repository";
import type { TrackRepository } from "../repositories/track-repository";

export type ImageGenerationOptions = {
  episodeId: string;
  dryRun?: boolean;
};

export type CodexImageImportOptions = {
  episodeId: string;
  heroImagePath: string;
  thumbnailImagePath: string;
  providerLabel?: string;
  modelLabel?: string;
};

export class ImageGenerationService {
  constructor(
    private readonly trackRepository: TrackRepository,
    private readonly episodePlanRepository: EpisodePlanRepository,
    private readonly assetRepository: AssetRepository,
    private readonly imageProvider: ImageProvider,
    private readonly logger: pino.Logger
  ) {}

  async generateEpisodeImages(options: ImageGenerationOptions) {
    const episode = this.trackRepository.getEpisode(options.episodeId);

    if (!episode) {
      throw new Error(`Episode not found: ${options.episodeId}`);
    }

    const plan = this.episodePlanRepository.getEpisodePlan(options.episodeId);

    if (!plan) {
      throw new Error(`Episode plan not found: ${options.episodeId}`);
    }

    const imageDir = join(episode.outputDir, "images");
    const rawDir = join(imageDir, "raw");
    mkdirSync(rawDir, { recursive: true });

    const heroRawPath = join(rawDir, `hero-source.${this.imageProvider.fileExtension}`);
    const thumbnailRawPath = join(rawDir, `thumbnail-source.${this.imageProvider.fileExtension}`);
    const heroPath = join(imageDir, "hero-1920x1080.png");
    const thumbnailBasePath = join(imageDir, "thumbnail-base-1280x720.png");
    const thumbnailFinalPath = join(imageDir, "thumbnail-final-1280x720.png");

    if (options.dryRun) {
      return {
        episodeId: options.episodeId,
        dryRun: true,
        provider: this.imageProvider.id,
        model: this.imageProvider.model,
        prompts: {
          hero: plan.visualPrompt,
          thumbnail: plan.thumbnailPrompt
        },
        outputPaths: {
          heroRawPath,
          thumbnailRawPath,
          heroPath,
          thumbnailBasePath,
          thumbnailFinalPath
        }
      };
    }

    this.trackRepository.markEpisodeStatus(options.episodeId, "images_generating");
    this.logger.info({ episodeId: options.episodeId }, "Generating hero image");
    const hero = await this.imageProvider.generateImage({ prompt: plan.visualPrompt });
    await writeFile(heroRawPath, hero.bytes);
    await render16x9Png(hero.bytes, heroPath, 1920, 1080);

    this.logger.info({ episodeId: options.episodeId }, "Generating thumbnail image");
    const thumbnail = await this.imageProvider.generateImage({ prompt: plan.thumbnailPrompt });
    await writeFile(thumbnailRawPath, thumbnail.bytes);
    await render16x9Png(thumbnail.bytes, thumbnailBasePath, 1280, 720);
    await renderThumbnailText({
      basePath: thumbnailBasePath,
      outputPath: thumbnailFinalPath,
      seriesText: plan.thumbnailText,
      subtitle: plan.subtitle
    });

    this.saveAssets({
      episodeId: options.episodeId,
      plan,
      heroPath,
      thumbnailBasePath,
      thumbnailFinalPath,
      heroRawPath,
      thumbnailRawPath,
      heroResponse: hero.rawResponse,
      thumbnailResponse: thumbnail.rawResponse
    });
    this.trackRepository.markEpisodeStatus(options.episodeId, "images_ready");

    return {
      episodeId: options.episodeId,
      dryRun: false,
      status: "images_ready",
      provider: this.imageProvider.id,
      model: this.imageProvider.model,
      heroPath,
      thumbnailBasePath,
      thumbnailFinalPath
    };
  }

  async importCodexGeneratedImages(options: CodexImageImportOptions) {
    const episode = this.trackRepository.getEpisode(options.episodeId);

    if (!episode) {
      throw new Error(`Episode not found: ${options.episodeId}`);
    }

    const plan = this.episodePlanRepository.getEpisodePlan(options.episodeId);

    if (!plan) {
      throw new Error(`Episode plan not found: ${options.episodeId}`);
    }

    const provider = options.providerLabel ?? "codex";
    const model = options.modelLabel ?? "gpt-image-2";
    const imageDir = join(episode.outputDir, "images");
    const rawDir = join(imageDir, "raw");
    mkdirSync(rawDir, { recursive: true });

    const heroRawPath = join(rawDir, `hero-source-codex${normalizeImageExtension(options.heroImagePath)}`);
    const thumbnailRawPath = join(
      rawDir,
      `thumbnail-source-codex${normalizeImageExtension(options.thumbnailImagePath)}`
    );
    const heroPath = join(imageDir, "hero-1920x1080.png");
    const thumbnailBasePath = join(imageDir, "thumbnail-base-1280x720.png");
    const thumbnailFinalPath = join(imageDir, "thumbnail-final-1280x720.png");

    this.trackRepository.markEpisodeStatus(options.episodeId, "images_generating");
    await copyFile(options.heroImagePath, heroRawPath);
    await copyFile(options.thumbnailImagePath, thumbnailRawPath);
    await render16x9Png(heroRawPath, heroPath, 1920, 1080);
    await render16x9Png(thumbnailRawPath, thumbnailBasePath, 1280, 720);
    await renderThumbnailText({
      basePath: thumbnailBasePath,
      outputPath: thumbnailFinalPath,
      seriesText: plan.thumbnailText,
      subtitle: plan.subtitle
    });

    this.saveAssets({
      episodeId: options.episodeId,
      plan,
      provider,
      model,
      heroPath,
      thumbnailBasePath,
      thumbnailFinalPath,
      heroRawPath,
      thumbnailRawPath,
      heroResponse: {
        importedFrom: options.heroImagePath,
        generatedBy: "Codex built-in image generation"
      },
      thumbnailResponse: {
        importedFrom: options.thumbnailImagePath,
        generatedBy: "Codex built-in image generation"
      }
    });
    this.trackRepository.markEpisodeStatus(options.episodeId, "images_ready");

    return {
      episodeId: options.episodeId,
      status: "images_ready",
      provider,
      model,
      heroPath,
      thumbnailBasePath,
      thumbnailFinalPath
    };
  }

  private saveAssets(input: {
    episodeId: string;
    plan: EpisodePlan;
    provider?: string;
    model?: string;
    heroPath: string;
    thumbnailBasePath: string;
    thumbnailFinalPath: string;
    heroRawPath: string;
    thumbnailRawPath: string;
    heroResponse: unknown;
    thumbnailResponse: unknown;
  }) {
    const provider = input.provider ?? this.imageProvider.id;
    const model = input.model ?? this.imageProvider.model;

    this.assetRepository.saveAsset({
      id: `${input.episodeId}-hero-image`,
      episodeId: input.episodeId,
      assetType: "hero_image",
      provider,
      prompt: input.plan.visualPrompt,
      filePath: input.heroPath,
      status: "images_ready",
      metadata: {
        model,
        rawPath: input.heroRawPath,
        rawResponse: input.heroResponse,
        width: 1920,
        height: 1080
      }
    });
    this.assetRepository.saveAsset({
      id: `${input.episodeId}-thumbnail-base`,
      episodeId: input.episodeId,
      assetType: "thumbnail_base",
      provider,
      prompt: input.plan.thumbnailPrompt,
      filePath: input.thumbnailBasePath,
      status: "images_ready",
      metadata: {
        model,
        rawPath: input.thumbnailRawPath,
        rawResponse: input.thumbnailResponse,
        width: 1280,
        height: 720
      }
    });
    this.assetRepository.saveAsset({
      id: `${input.episodeId}-thumbnail-final`,
      episodeId: input.episodeId,
      assetType: "thumbnail_final",
      provider: "sharp",
      prompt: "Programmatic thumbnail typography over generated thumbnail base.",
      filePath: input.thumbnailFinalPath,
      status: "images_ready",
      metadata: {
        seriesText: input.plan.thumbnailText,
        subtitle: input.plan.subtitle,
        width: 1280,
        height: 720
      }
    });
  }
}

async function render16x9Png(input: Buffer | string, outputPath: string, width: number, height: number) {
  await sharp(input).resize(width, height, { fit: "cover", position: "center" }).png().toFile(outputPath);
}

async function renderThumbnailText(input: {
  basePath: string;
  outputPath: string;
  seriesText: string;
  subtitle: string;
}) {
  const overlay = Buffer.from(`
<svg width="1280" height="720" viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#020612" stop-opacity="0.72"/>
      <stop offset="60%" stop-color="#020612" stop-opacity="0.24"/>
      <stop offset="100%" stop-color="#020612" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="1280" height="720" fill="url(#shade)"/>
  <text x="78" y="522" font-family="Arial, Helvetica, sans-serif" font-size="76" font-weight="800" fill="#F4F7FB" letter-spacing="0">${escapeXml(
    input.seriesText
  )}</text>
  <text x="82" y="574" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="500" fill="#C9D6E5" letter-spacing="0">${escapeXml(
    input.subtitle
  )}</text>
</svg>`);

  await sharp(input.basePath).composite([{ input: overlay, top: 0, left: 0 }]).png().toFile(input.outputPath);
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeImageExtension(filePath: string) {
  const extension = extname(filePath).toLowerCase();

  if (extension === ".jpg" || extension === ".jpeg" || extension === ".png" || extension === ".webp") {
    return extension;
  }

  return ".png";
}
