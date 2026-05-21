import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import type { MusicGenerationInput, MusicGenerationResult, MusicProvider } from "../domain/music-provider";

const minimaxResponseSchema = z.object({
  data: z
    .object({
      audio: z.string().optional(),
      status: z.number().optional()
    })
    .nullable()
    .optional(),
  trace_id: z.string().optional(),
  extra_info: z
    .object({
      music_duration: z.number().optional(),
      music_sample_rate: z.number().optional(),
      music_channel: z.number().optional(),
      bitrate: z.number().optional(),
      music_size: z.number().optional()
    })
    .nullable()
    .optional(),
  base_resp: z
    .object({
      status_code: z.number(),
      status_msg: z.string()
    })
    .optional()
});

export type MinimaxMusicProviderOptions = {
  apiKey: string;
  baseUrl: string;
  model: "music-2.6" | "music-2.6-free";
};

export class MinimaxMusicProvider implements MusicProvider {
  readonly id = "minimax";

  constructor(private readonly options: MinimaxMusicProviderOptions) {}

  get model() {
    return this.options.model;
  }

  async generateTrack(input: MusicGenerationInput): Promise<MusicGenerationResult> {
    if (input.prompt.length > 2000) {
      throw new Error(
        `MiniMax music prompt is ${input.prompt.length} characters; maximum is 2000.`
      );
    }

    const requestBody = JSON.stringify({
      model: this.options.model,
      prompt: input.prompt,
      stream: false,
      output_format: "url",
      audio_setting: {
        sample_rate: 44100,
        bitrate: 256000,
        format: "mp3"
      },
      lyrics_optimizer: false,
      is_instrumental: true
    });
    const response = await requestBufferWithRetry(`${this.options.baseUrl.replace(/\/$/, "")}/v1/music_generation`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(requestBody).toString()
      },
      body: requestBody
    });

    const responseText = response.body.toString("utf8");

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`MiniMax music generation failed: HTTP ${response.status} ${responseText}`);
    }

    const parsedJson = JSON.parse(responseText) as unknown;
    const parsed = minimaxResponseSchema.parse(parsedJson);

    if (parsed.base_resp && parsed.base_resp.status_code !== 0) {
      throw new Error(
        `MiniMax music generation failed: ${parsed.base_resp.status_code} ${parsed.base_resp.status_msg}`
      );
    }

    const audio = parsed.data?.audio;

    if (!audio) {
      throw new Error(`MiniMax response did not include data.audio: ${responseText.slice(0, 1000)}`);
    }

    const { bytes, sourceUrl } = await this.resolveAudioBytes(audio);
    mkdirSync(dirname(input.outputPath), { recursive: true });
    await writeFile(input.outputPath, bytes);

    return {
      provider: this.id,
      model: this.options.model,
      ...(parsed.trace_id ? { traceId: parsed.trace_id } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      filePath: input.outputPath,
      ...(parsed.extra_info?.music_duration
        ? { durationSeconds: parsed.extra_info.music_duration / 1000 }
        : {}),
      ...(parsed.extra_info?.music_sample_rate
        ? { sampleRate: parsed.extra_info.music_sample_rate }
        : {}),
      ...(parsed.extra_info?.bitrate ? { bitrate: parsed.extra_info.bitrate } : {}),
      ...(parsed.extra_info?.music_channel ? { channels: parsed.extra_info.music_channel } : {}),
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      rawResponse: parsedJson
    };
  }

  private async resolveAudioBytes(audio: string) {
    if (/^https?:\/\//.test(audio)) {
      const response = await requestBufferWithRetry(audio);

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`MiniMax generated audio download failed: HTTP ${response.status}`);
      }

      return {
        bytes: response.body,
        sourceUrl: audio
      };
    }

    return {
      bytes: Buffer.from(audio, "hex")
    };
  }
}

type RequestBufferInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  timeoutMs?: number;
};

async function requestBufferWithRetry(url: string, init: RequestBufferInit = {}) {
  const maxAttempts = 6;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await requestBuffer(url, init);

      if (response.status < 500 || attempt === maxAttempts) {
        return response;
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts) {
        break;
      }
    }

    await sleep(1000 * attempt);
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function requestBuffer(
  url: string,
  init: RequestBufferInit = {},
  redirectsRemaining = 4
): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "http:" ? http : https;
    const body = init.body ? Buffer.from(init.body) : undefined;
    const request = client.request(
      parsedUrl,
      {
        method: init.method ?? "GET",
        headers: init.headers,
        timeout: init.timeoutMs ?? 600000
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;

        if (location && status >= 300 && status < 400 && redirectsRemaining > 0) {
          response.resume();
          const redirectedUrl = new URL(location, parsedUrl).toString();
          const redirectedInit =
            status === 303
              ? omitRequestBody({ ...init, method: "GET" })
              : init;
          requestBuffer(redirectedUrl, redirectedInit, redirectsRemaining - 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve({ status, body: Buffer.concat(chunks) }));
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("HTTP request timed out."));
    });
    request.on("error", reject);

    if (body) {
      request.write(body);
    }

    request.end();
  });
}

function omitRequestBody(input: RequestBufferInit): RequestBufferInit {
  const { body: _body, ...withoutBody } = input;
  return withoutBody;
}
