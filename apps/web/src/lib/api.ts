import type {
  ApiError,
  AppConfig,
  CoverPreprocessInput,
  CoverPreprocessResult,
  CreateAnyGenerationInput,
  GenerateLyricsInput,
  GenerateLyricsResult,
  Generation,
  GenerationListResponse,
} from "@contracts";

export interface MusicApi {
  config(): Promise<AppConfig>;
  generations(offset?: number): Promise<GenerationListResponse>;
  create(input: CreateAnyGenerationInput): Promise<Generation>;
  generateLyrics(input: GenerateLyricsInput): Promise<GenerateLyricsResult>;
  preprocessCover(input: CoverPreprocessInput): Promise<CoverPreprocessResult>;
  rename(id: string, title: string): Promise<Generation>;
  retry(id: string): Promise<Generation>;
  remove(id: string): Promise<void>;
}

async function read<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const payload = await response.json() as T | ApiError;
  if (!response.ok) {
    const error = payload as ApiError;
    throw new Error(
      error.error?.message ?? `Request failed (${response.status})`,
    );
  }
  return payload as T;
}

export class HttpMusicApi implements MusicApi {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  config(): Promise<AppConfig> {
    return this.request<AppConfig>("/api/config");
  }

  generations(offset = 0): Promise<GenerationListResponse> {
    return this.request<GenerationListResponse>(
      `/api/generations?limit=100&offset=${offset}`,
    );
  }

  create(input: CreateAnyGenerationInput): Promise<Generation> {
    return this.request<Generation>("/api/generations", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  generateLyrics(input: GenerateLyricsInput): Promise<GenerateLyricsResult> {
    return this.request<GenerateLyricsResult>("/api/lyrics", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  preprocessCover(input: CoverPreprocessInput): Promise<CoverPreprocessResult> {
    return this.request<CoverPreprocessResult>("/api/covers/preprocess", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  rename(id: string, title: string): Promise<Generation> {
    return this.request<Generation>(`/api/generations/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
  }

  retry(id: string): Promise<Generation> {
    return this.request<Generation>(`/api/generations/${id}/retry`, {
      method: "POST",
    });
  }

  async remove(id: string): Promise<void> {
    await this.request<unknown>(`/api/generations/${id}`, {
      method: "DELETE",
    });
  }

  private async request<T>(url: string, init?: RequestInit): Promise<T> {
    const options = init?.body
      ? { ...init, headers: { "content-type": "application/json" } }
      : init;
    const fetcher = this.fetcher;
    const response = await fetcher(url, options);
    return read<T>(response);
  }
}
