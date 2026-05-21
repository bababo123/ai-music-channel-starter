import { readFile } from "node:fs/promises";
import type { CreatePageParameters } from "@notionhq/client/build/src/api-endpoints";
import type pino from "pino";
import {
  notionApprovalMap,
  notionDashboardProperties,
  notionDashboardSchema,
  notionStatusMap
} from "../domain/notion-dashboard";
import type { NotionDashboardProvider } from "../providers/notion-dashboard-provider";
import type { AssetRepository } from "../repositories/asset-repository";
import type {
  PublishAssetRow,
  PublishPackageRepository
} from "../repositories/publish-package-repository";

export type NotionSyncOptions = {
  episodeId: string;
  dryRun?: boolean;
};

type PublishPackageJson = {
  title?: string;
  description?: string;
  tags?: string[];
  visibility?: string;
  durationSeconds?: number;
  assets?: {
    videoPath?: string;
    thumbnailPath?: string;
    finalAudioPath?: string;
    previewPath?: string;
  };
};

export class NotionSyncService {
  constructor(
    private readonly publishRepository: PublishPackageRepository,
    private readonly assetRepository: AssetRepository,
    private readonly provider: NotionDashboardProvider | undefined,
    private readonly logger: pino.Logger
  ) {}

  async syncEpisode(options: NotionSyncOptions) {
    const episode = this.publishRepository.getEpisode(options.episodeId);

    if (!episode) {
      throw new Error(`Episode not found: ${options.episodeId}`);
    }

    const tracks = this.publishRepository.listTracks(episode.id);
    const assets = this.publishRepository.listAssets(episode.id);
    const packageAsset = assets.find((asset) => asset.assetType === "youtube_publish_package");

    if (!packageAsset) {
      throw new Error(`Episode ${episode.id} does not have a publish package. Run youtube:package first.`);
    }

    const publishPackage = await readPublishPackage(packageAsset);
    const title = publishPackage.title ?? episode.title;
    const durationSeconds = publishPackage.durationSeconds ?? estimateDurationSeconds(tracks);
    const now = new Date().toISOString();
    const pageTitle = `${episode.plan.seriesName} - ${episode.subtitle}`;
    const properties = buildProperties({
      episodeId: episode.id,
      series: episode.plan.seriesName,
      status: episode.status,
      visibility: publishPackage.visibility ?? "private",
      durationSeconds,
      title,
      assets: publishPackage.assets ?? {},
      ...(episode.publishAt ? { publishAt: episode.publishAt } : {}),
      ...(packageAsset.filePath ? { packagePath: packageAsset.filePath } : {}),
      syncedAt: now
    });
    const children = buildPageChildren({
      episode,
      title,
      publishPackage,
      tracks,
      status: episode.status,
      ...(packageAsset.filePath ? { packagePath: packageAsset.filePath } : {}),
      syncedAt: now
    });

    if (options.dryRun) {
      return {
        episodeId: episode.id,
        dryRun: true,
        pageTitle,
        properties,
        childBlocks: children?.length ?? 0
      };
    }

    if (!this.provider) {
      throw new Error("NOTION_API_KEY and NOTION_DATABASE_ID are required. Use --dry-run to preview.");
    }

    const result = await this.provider.upsertEpisodePage({
      episodeId: episode.id,
      title: pageTitle,
      properties,
      children
    });

    this.assetRepository.saveAsset({
      id: `${episode.id}-notion-dashboard-page`,
      episodeId: episode.id,
      assetType: "notion_dashboard_page",
      provider: "notion",
      filePath: result.pageUrl,
      status: episode.status,
      metadata: {
        pageId: result.pageId,
        pageUrl: result.pageUrl,
        action: result.action,
        syncedAt: now,
        packageAssetId: packageAsset.id
      }
    });
    this.logger.info(
      { episodeId: episode.id, pageId: result.pageId, action: result.action },
      "Synced Notion dashboard page"
    );

    return {
      episodeId: episode.id,
      dryRun: false,
      status: episode.status,
      action: result.action,
      pageId: result.pageId,
      pageUrl: result.pageUrl
    };
  }

  async inspectSchema() {
    if (!this.provider) {
      return {
        configured: false,
        requiredProperties: notionDashboardSchema
      };
    }

    const target = await this.provider.inspectTarget();
    const missing = notionDashboardSchema
      .filter((property) => property.type !== "title")
      .filter((property) => !target.existingProperties.has(property.name));

    return {
      configured: true,
      target: {
        id: target.id,
        mode: target.mode,
        titlePropertyName: target.titlePropertyName
      },
      missingProperties: missing,
      requiredProperties: notionDashboardSchema
    };
  }

  async ensureSchema() {
    if (!this.provider) {
      throw new Error("NOTION_API_KEY and NOTION_DATABASE_ID are required to ensure the Notion schema.");
    }

    return this.provider.ensureSchema();
  }
}

async function readPublishPackage(packageAsset: PublishAssetRow): Promise<PublishPackageJson> {
  const jsonPath = packageAsset.metadata.jsonPath;

  if (typeof jsonPath !== "string") {
    return {};
  }

  const content = await readFile(jsonPath, "utf8");

  return JSON.parse(content) as PublishPackageJson;
}

function buildProperties(input: {
  episodeId: string;
  series: string;
  status: string;
  visibility: string;
  durationSeconds: number;
  publishAt?: string;
  title: string;
  assets: NonNullable<PublishPackageJson["assets"]>;
  packagePath?: string;
  syncedAt: string;
}) {
  return {
    [notionDashboardProperties.episodeId]: {
      rich_text: [{ text: { content: input.episodeId } }]
    },
    [notionDashboardProperties.series]: {
      select: { name: input.series }
    },
    [notionDashboardProperties.status]: {
      status: { name: notionStatusMap[input.status] ?? input.status }
    },
    [notionDashboardProperties.approval]: {
      select: { name: notionApprovalMap[input.status] ?? "Pending" }
    },
    [notionDashboardProperties.visibility]: {
      select: { name: input.visibility }
    },
    [notionDashboardProperties.runtimeMinutes]: {
      number: Math.round((input.durationSeconds / 60) * 10) / 10
    },
    [notionDashboardProperties.publishDate]: {
      date: input.publishAt ? { start: input.publishAt } : null
    },
    [notionDashboardProperties.finalVideoPath]: richTextPath(input.assets.videoPath),
    [notionDashboardProperties.thumbnailPath]: richTextPath(input.assets.thumbnailPath),
    [notionDashboardProperties.publishPackagePath]: richTextPath(input.packagePath),
    [notionDashboardProperties.previewAudioPath]: richTextPath(input.assets.previewPath),
    [notionDashboardProperties.youtubeTitle]: richTextPath(input.title),
    [notionDashboardProperties.lastSyncedAt]: {
      date: { start: input.syncedAt }
    }
  };
}

function buildPageChildren(input: {
  episode: NonNullable<ReturnType<PublishPackageRepository["getEpisode"]>>;
  title: string;
  publishPackage: PublishPackageJson;
  packagePath?: string;
  tracks: ReturnType<PublishPackageRepository["listTracks"]>;
  status: string;
  syncedAt: string;
}): CreatePageParameters["children"] {
  const description = input.publishPackage.description ?? "";
  const tags = input.publishPackage.tags ?? [];
  const assets = input.publishPackage.assets ?? {};

  return [
    heading("Review"),
    paragraph(`Status: ${input.status}`),
    paragraph(`Synced at: ${input.syncedAt}`),
    paragraph("Human approval is required before YouTube upload automation is allowed."),
    heading("Assets"),
    bulleted(`Final video: ${assets.videoPath ?? "MISSING"}`),
    bulleted(`Thumbnail: ${assets.thumbnailPath ?? "MISSING"}`),
    bulleted(`Publish package: ${input.packagePath ?? "MISSING"}`),
    bulleted(`Preview audio: ${assets.previewPath ?? "MISSING"}`),
    heading("YouTube Title"),
    ...codeBlocks(input.title),
    heading("Description"),
    ...codeBlocks(description),
    heading("Tags"),
    ...codeBlocks(tags.join(", ")),
    heading("Tracks"),
    ...input.tracks.map((track) =>
      bulleted(
        `${track.trackIndex.toString().padStart(2, "0")}. ${track.title} - ${formatRuntime(
          track.durationSeconds ?? track.durationTargetSeconds
        )} - ${track.status}`
      )
    )
  ].slice(0, 100);
}

function richTextPath(value: string | undefined) {
  return {
    rich_text: value ? [{ text: { content: value.slice(0, 2000) } }] : []
  };
}

function heading(content: string) {
  return {
    object: "block" as const,
    type: "heading_2" as const,
    heading_2: {
      rich_text: [{ text: { content } }]
    }
  };
}

function paragraph(content: string) {
  return {
    object: "block" as const,
    type: "paragraph" as const,
    paragraph: {
      rich_text: [{ text: { content: content.slice(0, 2000) } }]
    }
  };
}

function bulleted(content: string) {
  return {
    object: "block" as const,
    type: "bulleted_list_item" as const,
    bulleted_list_item: {
      rich_text: [{ text: { content: content.slice(0, 2000) } }]
    }
  };
}

function codeBlocks(content: string) {
  const chunks = chunkString(content, 1900);

  return chunks.map((chunk) => ({
    object: "block" as const,
    type: "code" as const,
    code: {
      language: "plain text" as const,
      rich_text: [{ text: { content: chunk } }]
    }
  }));
}

function chunkString(content: string, size: number) {
  if (!content) {
    return [""];
  }

  const chunks: string[] = [];

  for (let index = 0; index < content.length; index += size) {
    chunks.push(content.slice(index, index + size));
  }

  return chunks;
}

function estimateDurationSeconds(
  tracks: ReturnType<PublishPackageRepository["listTracks"]>
) {
  return tracks.reduce(
    (total, track) => total + (track.durationSeconds ?? track.durationTargetSeconds),
    0
  );
}

function formatRuntime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
