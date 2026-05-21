import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv({ quiet: true });

const blankToUndefined = (value: unknown) => {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
};

const optionalSecret = z.preprocess(blankToUndefined, z.string().min(1).optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DB_PATH: z.string().min(1).default("./data/music-channel.sqlite"),
  OUTPUT_DIR: z.string().min(1).default("./outputs"),
  PUBLISH_TIMEZONE: z.string().min(1).default("Asia/Taipei"),
  DAILY_PUBLISH_HOUR: z.coerce.number().int().min(0).max(23).default(21),
  MINIMAX_API_KEY: optionalSecret,
  MINIMAX_GROUP_ID: optionalSecret,
  MINIMAX_BASE_URL: z.string().url().default("https://api.minimax.io"),
  MINIMAX_MUSIC_MODEL: z.enum(["music-2.6", "music-2.6-free"]).default("music-2.6"),
  OPENAI_API_KEY: optionalSecret,
  OPENAI_IMAGE_MODEL: z
    .enum(["gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"])
    .default("gpt-image-1.5"),
  OPENAI_IMAGE_SIZE: z
    .enum(["1024x1024", "1536x1024", "1024x1536", "auto"])
    .default("1536x1024"),
  OPENAI_IMAGE_QUALITY: z.enum(["low", "medium", "high", "auto"]).default("high"),
  OPENAI_IMAGE_FORMAT: z.enum(["png", "jpeg", "webp"]).default("png"),
  NOTION_API_KEY: optionalSecret,
  NOTION_DATABASE_ID: optionalSecret,
  YOUTUBE_CLIENT_ID: optionalSecret,
  YOUTUBE_CLIENT_SECRET: optionalSecret,
  YOUTUBE_REFRESH_TOKEN: optionalSecret,
  YOUTUBE_CHANNEL_ID: optionalSecret,
  YOUTUBE_REDIRECT_URI: z.string().url().default("http://localhost:53682/oauth2callback"),
  YOUTUBE_ACTIVE_CHANNEL: z.string().min(1).default("default"),
  YOUTUBE_CHANNELS_JSON: z.string().min(1).optional()
});

export type AppConfig = ReturnType<typeof loadConfig>;

export type YouTubeChannelProfile = {
  key: string;
  name?: string;
  channelId?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  redirectUri: string;
  defaultPlaylistId?: string;
  playlists: Record<string, string>;
};

export function loadConfig() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  const env = parsed.data;

  return {
    ...env,
    youtubeChannelProfiles: parseYouTubeChannelProfiles(env),
    dbPath: resolve(env.DB_PATH),
    outputDir: resolve(env.OUTPUT_DIR)
  };
}

function parseYouTubeChannelProfiles(env: z.infer<typeof envSchema>) {
  const profiles = new Map<string, YouTubeChannelProfile>();
  const legacyProfile = {
    key: "default",
    ...(env.YOUTUBE_CHANNEL_ID ? { channelId: env.YOUTUBE_CHANNEL_ID } : {}),
    ...(env.YOUTUBE_CLIENT_ID ? { clientId: env.YOUTUBE_CLIENT_ID } : {}),
    ...(env.YOUTUBE_CLIENT_SECRET ? { clientSecret: env.YOUTUBE_CLIENT_SECRET } : {}),
    ...(env.YOUTUBE_REFRESH_TOKEN ? { refreshToken: env.YOUTUBE_REFRESH_TOKEN } : {}),
    redirectUri: env.YOUTUBE_REDIRECT_URI,
    playlists: {}
  } satisfies YouTubeChannelProfile;

  profiles.set("default", legacyProfile);

  if (!env.YOUTUBE_CHANNELS_JSON) {
    return profiles;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(env.YOUTUBE_CHANNELS_JSON);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid YOUTUBE_CHANNELS_JSON: ${message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("YOUTUBE_CHANNELS_JSON must be a JSON object keyed by channel profile name.");
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`YOUTUBE_CHANNELS_JSON.${key} must be an object.`);
    }

    const record = value as Record<string, unknown>;
    const name = readOptionalString(record.name);
    const channelId = readOptionalString(record.channelId);
    const clientId = readOptionalString(record.clientId) ?? env.YOUTUBE_CLIENT_ID;
    const clientSecret = readOptionalString(record.clientSecret) ?? env.YOUTUBE_CLIENT_SECRET;
    const refreshToken = readOptionalString(record.refreshToken);
    const defaultPlaylistId = readOptionalString(record.defaultPlaylistId);
    const playlists = readOptionalStringMap(record.playlists, `YOUTUBE_CHANNELS_JSON.${key}.playlists`);

    profiles.set(key, {
      key,
      ...(name ? { name } : {}),
      ...(channelId ? { channelId } : {}),
      ...(clientId ? { clientId } : {}),
      ...(clientSecret ? { clientSecret } : {}),
      ...(refreshToken ? { refreshToken } : {}),
      redirectUri: readOptionalString(record.redirectUri) ?? env.YOUTUBE_REDIRECT_URI,
      ...(defaultPlaylistId ? { defaultPlaylistId } : {}),
      playlists
    });
  }

  return profiles;
}

function readOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

function readOptionalStringMap(value: unknown, path: string) {
  const result: Record<string, string> = {};

  if (value === undefined || value === null || value === "") {
    return result;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object keyed by series or playlist name.`);
  }

  for (const [key, rawValue] of Object.entries(value)) {
    const playlistId = readOptionalString(rawValue);

    if (!playlistId) {
      continue;
    }

    result[key] = playlistId;
  }

  return result;
}
