export const notionDashboardProperties = {
  title: "Name",
  episodeId: "Episode ID",
  series: "Series",
  status: "Status",
  approval: "Approval",
  visibility: "Visibility",
  runtimeMinutes: "Runtime Minutes",
  publishDate: "Publish Date",
  finalVideoPath: "Final Video Path",
  thumbnailPath: "Thumbnail Path",
  publishPackagePath: "Publish Package Path",
  previewAudioPath: "Preview Audio Path",
  youtubeTitle: "YouTube Title",
  lastSyncedAt: "Last Synced At"
} as const;

export type NotionDashboardPropertyName =
  (typeof notionDashboardProperties)[keyof typeof notionDashboardProperties];

export const notionDashboardSchema = [
  { name: notionDashboardProperties.title, type: "title" },
  { name: notionDashboardProperties.episodeId, type: "rich_text" },
  { name: notionDashboardProperties.series, type: "select" },
  { name: notionDashboardProperties.status, type: "status" },
  { name: notionDashboardProperties.approval, type: "select" },
  { name: notionDashboardProperties.visibility, type: "select" },
  { name: notionDashboardProperties.runtimeMinutes, type: "number" },
  { name: notionDashboardProperties.publishDate, type: "date" },
  { name: notionDashboardProperties.finalVideoPath, type: "rich_text" },
  { name: notionDashboardProperties.thumbnailPath, type: "rich_text" },
  { name: notionDashboardProperties.publishPackagePath, type: "rich_text" },
  { name: notionDashboardProperties.previewAudioPath, type: "rich_text" },
  { name: notionDashboardProperties.youtubeTitle, type: "rich_text" },
  { name: notionDashboardProperties.lastSyncedAt, type: "date" }
] as const;

export type NotionDashboardSchemaItem = (typeof notionDashboardSchema)[number];

export const notionStatusMap: Record<string, string> = {
  planned: "Planned",
  music_generating: "Music Generating",
  music_ready: "Music Ready",
  audio_mixing: "Audio Mixing",
  audio_ready: "Audio Ready",
  images_generating: "Images Generating",
  images_ready: "Images Ready",
  rendering: "Rendering",
  needs_approval: "Needs Approval",
  approved: "Approved",
  regenerate_requested: "Regenerate Requested",
  uploading: "Uploading",
  uploaded: "Uploaded",
  scheduled: "Scheduled",
  failed: "Failed"
};

export const notionApprovalMap: Record<string, string> = {
  needs_approval: "Pending",
  approved: "Approved",
  uploading: "Approved",
  uploaded: "Approved",
  scheduled: "Approved",
  regenerate_requested: "Regenerate"
};
