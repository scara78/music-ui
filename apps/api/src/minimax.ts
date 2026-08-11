import type {
  AudioFormat,
  CoverPreprocessInput,
  CoverPreprocessResult,
  CreateAnyGenerationInput,
  GenerateLyricsInput,
  GenerateLyricsResult,
} from "@contracts/index.ts";
import { ProviderError } from "./errors.ts";

export interface GeneratedAudio {
  bytes: Uint8Array;
  durationMs: number | null;
  traceId: string | null;
}

export interface MusicProvider {
  generate(input: CreateAnyGenerationInput): Promise<GeneratedAudio>;
  generateLyrics(input: GenerateLyricsInput): Promise<GenerateLyricsResult>;
  preprocessCover(input: CoverPreprocessInput): Promise<CoverPreprocessResult>;
}

interface MiniMaxResponse {
  data?: { audio?: string; audio_url?: string; status?: number };
  trace_id?: string;
  extra_info?: { music_duration?: number };
  base_resp?: { status_code?: number; status_msg?: string };
}

interface MiniMaxLyricsResponse {
  song_title?: string;
  style_tags?: string;
  lyrics?: string;
  base_resp?: { status_code?: number; status_msg?: string };
}

interface MiniMaxCoverPreprocessResponse {
  cover_feature_id?: string;
  formatted_lyrics?: string;
  structure_result?: string;
  audio_duration?: number;
  trace_id?: string;
  base_resp?: { status_code?: number; status_msg?: string };
}

export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface MiniMaxClientOptions {
  generationTimeoutMs?: number;
  downloadTimeoutMs?: number;
  maxAudioBytes?: number;
  downloadAttempts?: number;
}

const STATUS_MESSAGES: Record<number, string> = {
  1000: "MiniMax reported an unknown error. Try again later.",
  1001: "MiniMax timed out. The request was not retried to avoid a duplicate song.",
  1002: "The MiniMax rate limit was reached. Try again in a moment.",
  1004: "MiniMax rejected the API key.",
  1008: "The MiniMax account has insufficient balance or quota.",
  1024: "MiniMax encountered an internal error.",
  1026: "MiniMax flagged the input as sensitive. Adjust the prompt or lyrics.",
  1027: "MiniMax flagged the output as sensitive. Adjust the prompt or lyrics.",
  1041: "The MiniMax connection limit was reached.",
  1042: "The input contains too many invisible or unsupported characters.",
  2013: "MiniMax rejected one or more generation parameters.",
  2049: "The MiniMax API key is invalid.",
  2056: "The free resource window is exhausted. Try again in the next window.",
};

function decodeHex(value: string): Uint8Array {
  if (!/^(?:[\da-fA-F]{2})+$/.test(value)) {
    throw new ProviderError("invalid_audio", "MiniMax returned malformed audio data.");
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function isTimeout(error: unknown): boolean {
  return error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError");
}

function hasExpectedMagic(bytes: Uint8Array, format: AudioFormat): boolean {
  if (format === "pcm") return bytes.length > 0;
  if (format === "wav") {
    return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WAVE";
  }
  return bytes.length >= 3 &&
    (String.fromCharCode(...bytes.slice(0, 3)) === "ID3" ||
      (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0));
}

async function parseResponse<T>(response: Response): Promise<T> {
  try {
    return JSON.parse(await response.text()) as T;
  } catch {
    throw new ProviderError("invalid_response", "MiniMax returned an unreadable response.");
  }
}

function generationRequest(input: CreateAnyGenerationInput): Record<string, unknown> {
  const common = {
    model: input.model,
    prompt: input.prompt,
    lyrics: input.lyrics || undefined,
    stream: false,
    output_format: "url",
    audio_setting: {
      sample_rate: input.audio.sampleRate,
      bitrate: input.audio.bitrate,
      format: input.audio.format,
    },
  };
  if ("source" in input) {
    const source = input.source.type === "url"
      ? { audio_url: input.source.url }
      : input.source.type === "base64"
      ? { audio_base64: input.source.data }
      : { cover_feature_id: input.source.featureId };
    return { ...common, ...source };
  }
  return {
    ...common,
    lyrics_optimizer: input.lyricsOptimizer,
    is_instrumental: input.instrumental,
  };
}

export class MiniMaxClient implements MusicProvider {
  private readonly generationTimeoutMs: number;
  private readonly downloadTimeoutMs: number;
  private readonly maxAudioBytes: number;
  private readonly downloadAttempts: number;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly fetcher: Fetcher = fetch,
    options: MiniMaxClientOptions = {},
  ) {
    this.generationTimeoutMs = options.generationTimeoutMs ?? 8 * 60_000;
    this.downloadTimeoutMs = options.downloadTimeoutMs ?? 60_000;
    this.maxAudioBytes = options.maxAudioBytes ?? 64 * 1024 * 1024;
    this.downloadAttempts = options.downloadAttempts ?? 2;
  }

  async generate(input: CreateAnyGenerationInput): Promise<GeneratedAudio> {
    if (!this.apiKey) {
      throw new ProviderError("missing_api_key", "Set MINIMAX_API_KEY before generating music.");
    }

    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}/v1/music_generation`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(this.generationTimeoutMs),
        body: JSON.stringify(generationRequest(input)),
      });
    } catch (error) {
      if (isTimeout(error)) {
        throw new ProviderError(
          "generation_timeout",
          "MiniMax generation timed out and was not retried to avoid a duplicate song.",
        );
      }
      throw error;
    }

    if (!response.ok) {
      throw new ProviderError(
        `http_${response.status}`,
        `MiniMax returned HTTP ${response.status}.`,
      );
    }
    const payload = await parseResponse<MiniMaxResponse>(response);
    const statusCode = payload.base_resp?.status_code;
    if (statusCode === undefined) {
      throw new ProviderError(
        "invalid_response",
        "MiniMax omitted its response status.",
        payload.trace_id ?? null,
      );
    }
    if (statusCode !== 0) {
      throw new ProviderError(
        String(statusCode),
        STATUS_MESSAGES[statusCode] ?? payload.base_resp?.status_msg ??
          "MiniMax rejected the request.",
        payload.trace_id ?? null,
      );
    }
    if (payload.data?.status !== 2) {
      throw new ProviderError(
        "incomplete_generation",
        "MiniMax did not return a completed song.",
        payload.trace_id ?? null,
      );
    }

    const audio = payload.data.audio_url ?? payload.data.audio;
    if (!audio) {
      throw new ProviderError(
        "missing_audio",
        "MiniMax completed without returning audio.",
        payload.trace_id ?? null,
      );
    }

    let bytes: Uint8Array;
    try {
      bytes = /^https?:\/\//i.test(audio)
        ? await this.download(audio, input.audio.format)
        : decodeHex(audio);
      if (bytes.byteLength > this.maxAudioBytes) {
        throw new ProviderError(
          "audio_too_large",
          "MiniMax audio exceeded the 64 MiB storage limit.",
        );
      }
      if (!hasExpectedMagic(bytes, input.audio.format)) {
        throw new ProviderError(
          "invalid_audio",
          `MiniMax returned invalid ${input.audio.format.toUpperCase()} audio.`,
        );
      }
    } catch (error) {
      if (error instanceof ProviderError && payload.trace_id) {
        throw new ProviderError(error.code, error.message, payload.trace_id);
      }
      throw error;
    }

    return {
      bytes,
      durationMs: payload.extra_info?.music_duration ?? null,
      traceId: payload.trace_id ?? null,
    };
  }

  async generateLyrics(input: GenerateLyricsInput): Promise<GenerateLyricsResult> {
    const payload = await this.postJson<MiniMaxLyricsResponse>(
      "/v1/lyrics_generation",
      {
        mode: input.mode,
        prompt: input.prompt,
        lyrics: input.lyrics,
        title: input.title,
      },
      "lyrics_timeout",
      "MiniMax lyric generation timed out.",
    );
    this.assertSuccess(payload);
    if (
      typeof payload.song_title !== "string" || typeof payload.style_tags !== "string" ||
      typeof payload.lyrics !== "string"
    ) {
      throw new ProviderError("invalid_response", "MiniMax returned incomplete lyric data.");
    }
    return {
      songTitle: payload.song_title,
      styleTags: payload.style_tags,
      lyrics: payload.lyrics,
    };
  }

  async preprocessCover(input: CoverPreprocessInput): Promise<CoverPreprocessResult> {
    const source = input.source.type === "url"
      ? { audio_url: input.source.url }
      : { audio_base64: input.source.data };
    const payload = await this.postJson<MiniMaxCoverPreprocessResponse>(
      "/v1/music_cover_preprocess",
      { model: "music-cover", ...source },
      "cover_preprocess_timeout",
      "MiniMax cover preprocessing timed out.",
    );
    this.assertSuccess(payload, payload.trace_id ?? null);
    if (
      typeof payload.cover_feature_id !== "string" ||
      typeof payload.formatted_lyrics !== "string" ||
      typeof payload.structure_result !== "string" ||
      typeof payload.audio_duration !== "number"
    ) {
      throw new ProviderError(
        "invalid_response",
        "MiniMax returned incomplete cover preprocessing data.",
        payload.trace_id ?? null,
      );
    }
    return {
      coverFeatureId: payload.cover_feature_id,
      formattedLyrics: payload.formatted_lyrics,
      structureResult: payload.structure_result,
      audioDuration: payload.audio_duration,
      traceId: payload.trace_id ?? null,
    };
  }

  private async postJson<
    T extends {
      base_resp?: { status_code?: number; status_msg?: string };
    },
  >(
    path: string,
    body: Record<string, unknown>,
    timeoutCode: string,
    timeoutMessage: string,
  ): Promise<T> {
    if (!this.apiKey) {
      throw new ProviderError("missing_api_key", "Set MINIMAX_API_KEY before using MiniMax.");
    }
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(this.generationTimeoutMs),
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (isTimeout(error)) throw new ProviderError(timeoutCode, timeoutMessage);
      throw new ProviderError("transport_error", "Could not reach MiniMax.");
    }
    if (!response.ok) {
      throw new ProviderError(
        `http_${response.status}`,
        `MiniMax returned HTTP ${response.status}.`,
      );
    }
    return await parseResponse<T>(response);
  }

  private assertSuccess(
    payload: { base_resp?: { status_code?: number; status_msg?: string } },
    traceId: string | null = null,
  ): void {
    const statusCode = payload.base_resp?.status_code;
    if (statusCode === undefined) {
      throw new ProviderError("invalid_response", "MiniMax omitted its response status.", traceId);
    }
    if (statusCode !== 0) {
      throw new ProviderError(
        String(statusCode),
        STATUS_MESSAGES[statusCode] ?? payload.base_resp?.status_msg ??
          "MiniMax rejected the request.",
        traceId,
      );
    }
  }

  private async download(url: string, format: AudioFormat): Promise<Uint8Array> {
    for (let attempt = 0; attempt < this.downloadAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetcher(url, {
          signal: AbortSignal.timeout(this.downloadTimeoutMs),
        });
      } catch (error) {
        if (attempt + 1 < this.downloadAttempts) continue;
        if (isTimeout(error)) {
          throw new ProviderError("audio_download_timeout", "MiniMax audio download timed out.");
        }
        throw new ProviderError("audio_download_failed", "MiniMax audio download failed.");
      }

      if (!response.ok) {
        if (response.status >= 500 && attempt + 1 < this.downloadAttempts) continue;
        throw new ProviderError(
          "audio_download_failed",
          `MiniMax audio download returned HTTP ${response.status}.`,
        );
      }

      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > this.maxAudioBytes) {
        throw new ProviderError(
          "audio_too_large",
          "MiniMax audio exceeded the 64 MiB storage limit.",
        );
      }
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim()
        .toLowerCase();
      if (
        contentType && !contentType.startsWith("audio/") &&
        contentType !== "application/octet-stream" && contentType !== "binary/octet-stream"
      ) {
        throw new ProviderError(
          "invalid_audio_type",
          `MiniMax returned ${contentType} instead of audio.`,
        );
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length === 0) {
        throw new ProviderError("empty_audio", "MiniMax returned an empty audio file.");
      }
      if (!hasExpectedMagic(bytes, format)) {
        throw new ProviderError(
          "invalid_audio",
          `MiniMax returned invalid ${format.toUpperCase()} audio.`,
        );
      }
      return bytes;
    }
    throw new ProviderError("audio_download_failed", "MiniMax audio download failed.");
  }
}
