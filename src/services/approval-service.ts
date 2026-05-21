import { existsSync } from "node:fs";
import type pino from "pino";
import type { ApprovalDecision, ApprovalRepository } from "../repositories/approval-repository";

export type ReviewDecisionOptions = {
  episodeId: string;
  decision: ApprovalDecision;
  reviewer?: string;
  notes?: string;
};

export class ApprovalService {
  constructor(
    private readonly approvalRepository: ApprovalRepository,
    private readonly logger: pino.Logger
  ) {}

  saveDecision(options: ReviewDecisionOptions) {
    const episode = this.approvalRepository.getEpisode(options.episodeId);

    if (!episode) {
      throw new Error(`Episode not found: ${options.episodeId}`);
    }

    if (!["needs_approval", "approved"].includes(episode.status)) {
      throw new Error(
        `Episode ${episode.id} is currently "${episode.status}". Run youtube:package and complete review before approving.`
      );
    }

    if (episode.status === "approved" && options.decision === "approved") {
      return {
        episodeId: episode.id,
        decision: "approved" as const,
        status: "approved",
        alreadyApproved: true,
        title: episode.title
      };
    }

    const assets = this.approvalRepository.listAssets(episode.id);
    const packageAsset = assets.find((asset) => asset.assetType === "youtube_publish_package");
    const requiredPaths = collectRequiredPaths(assets, packageAsset);
    const missingPaths = requiredPaths.filter((filePath) => !existsSync(filePath));

    if (!packageAsset) {
      throw new Error(`Episode ${episode.id} does not have a YouTube publish package yet.`);
    }

    if (options.decision === "approved" && missingPaths.length > 0) {
      throw new Error(`Cannot approve episode ${episode.id}; missing files: ${missingPaths.join(", ")}`);
    }

    const result = this.approvalRepository.saveReviewDecision({
      episodeId: episode.id,
      decision: options.decision,
      reviewer: options.reviewer ?? "manual",
      ...(options.notes ? { notes: options.notes } : {}),
      packageAssetId: packageAsset.id,
      metadata: {
        previousStatus: episode.status,
        title: episode.title,
        requiredPaths
      }
    });

    this.logger.info(
      { episodeId: episode.id, decision: options.decision, reviewer: result.reviewer },
      "Saved review decision"
    );

    return {
      ...result,
      status: options.decision,
      title: episode.title,
      checkedFiles: requiredPaths.length
    };
  }

  assertApprovedForUpload(episodeId: string) {
    const episode = this.approvalRepository.getEpisode(episodeId);

    if (!episode) {
      throw new Error(`Episode not found: ${episodeId}`);
    }

    if (episode.status !== "approved") {
      throw new Error(`Episode ${episode.id} is "${episode.status}", not approved. Upload is blocked.`);
    }

    return {
      episodeId: episode.id,
      status: episode.status,
      title: episode.title
    };
  }
}

function collectRequiredPaths(
  assets: ReturnType<ApprovalRepository["listAssets"]>,
  packageAsset: ReturnType<ApprovalRepository["listAssets"]>[number] | undefined
) {
  const paths = new Set<string>();

  for (const assetType of ["thumbnail_final", "final_audio_mix", "audio_preview"]) {
    const asset = assets.find((candidate) => candidate.assetType === assetType);

    if (asset?.filePath) {
      paths.add(asset.filePath);
    }
  }

  if (packageAsset?.filePath) {
    paths.add(packageAsset.filePath);
  }

  const metadataVideoPath = packageAsset?.metadata.videoPath;
  const metadataJsonPath = packageAsset?.metadata.jsonPath;

  if (typeof metadataVideoPath === "string") {
    paths.add(metadataVideoPath);
  }

  if (typeof metadataJsonPath === "string") {
    paths.add(metadataJsonPath);
  }

  return [...paths];
}
