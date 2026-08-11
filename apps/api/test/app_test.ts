import assert from "node:assert/strict";
import type {
  AppConfig,
  CoverPreprocessInput,
  CoverPreprocessResult,
  GenerateLyricsInput,
  GenerateLyricsResult,
  Generation,
  GenerationListResponse,
} from "@contracts/index.ts";
import { audioContentDisposition, createApp } from "../src/app.ts";
import { ProviderError } from "../src/errors.ts";
import { type GenerationRepository, openMemoryRepository } from "../src/repository.ts";
import type { GenerationRunner } from "../src/runner.ts";
import type { AudioStorage, StoredAudio } from "../src/storage.ts";
import { makeInput, NOW } from "./fixtures.ts";

class RunnerSpy {
  readonly calls: Array<{ tenantId: string; id: string }> = [];

  enqueue(tenantId: string, id: string): void {
    this.calls.push({ tenantId, id });
  }
}

class MemoryStorage implements AudioStorage {
  readonly files = new Map<string, Uint8Array>();
  readonly deleted: string[] = [];
  readError: Error | null = null;
  deleteError: Error | null = null;

  save(
    _tenantId: string,
    generationId: string,
    _format: "mp3" | "wav" | "pcm",
    bytes: Uint8Array,
  ): Promise<StoredAudio> {
    const path = `/memory/${generationId}`;
    this.files.set(path, bytes);
    return Promise.resolve({
      path,
      mimeType: "audio/mpeg",
      sizeBytes: bytes.length,
      sha256: "hash",
    });
  }

  read(path: string): Promise<Uint8Array> {
    if (this.readError) return Promise.reject(this.readError);
    const bytes = this.files.get(path);
    if (!bytes) return Promise.reject(new Error("missing in-memory audio"));
    return Promise.resolve(bytes);
  }

  delete(path: string): Promise<void> {
    if (this.deleteError) return Promise.reject(this.deleteError);
    this.deleted.push(path);
    this.files.delete(path);
    return Promise.resolve();
  }
}

class UtilityProvider {
  lyricsCalls: GenerateLyricsInput[] = [];
  preprocessCalls: CoverPreprocessInput[] = [];
  lyricsError: unknown = null;
  preprocessError: unknown = null;

  generateLyrics(input: GenerateLyricsInput): Promise<GenerateLyricsResult> {
    this.lyricsCalls.push(input);
    if (this.lyricsError) return Promise.reject(this.lyricsError);
    return Promise.resolve({ songTitle: "Generated", styleTags: "Pop", lyrics: "[Verse]\nSong" });
  }

  preprocessCover(input: CoverPreprocessInput): Promise<CoverPreprocessResult> {
    this.preprocessCalls.push(input);
    if (this.preprocessError) return Promise.reject(this.preprocessError);
    return Promise.resolve({
      coverFeatureId: "feature-id",
      formattedLyrics: "[Verse]\nWords",
      structureResult: "{}",
      audioDuration: 90,
      traceId: "trace",
    });
  }
}

const BASE_CONFIG = {
  allowTenantHeader: false,
  defaultTenantId: "tenant-default",
  defaultModel: "music-3.0-free" as const,
  freeRateLimitRpm: 3,
  minimaxApiKey: "",
};

const MP3_BYTES = new Uint8Array([0x49, 0x44, 0x33]);

function setup(options: {
  config?: Partial<typeof BASE_CONFIG>;
  repository?: GenerationRepository;
  storage?: MemoryStorage;
  provider?: UtilityProvider;
  useDefaultFactories?: boolean;
} = {}) {
  const repository = options.repository ?? openMemoryRepository();
  const storage = options.storage ?? new MemoryStorage();
  const provider = options.provider ?? new UtilityProvider();
  const runner = new RunnerSpy();
  const dependencies = {
    config: { ...BASE_CONFIG, ...options.config },
    repository,
    runner: runner as unknown as GenerationRunner,
    storage,
    provider,
  };
  const app = options.useDefaultFactories
    ? createApp(dependencies)
    : createApp({ ...dependencies, now: () => NOW, id: () => "generated-id" });
  return { app, repository, runner, storage, provider };
}

async function json<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

function jsonRequest(method: string, body: unknown, headers: HeadersInit = {}): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

function assertPublicGeneration(value: unknown): void {
  const record = value as Record<string, unknown>;
  for (
    const key of [
      "tenantId",
      "audioPath",
      "audioMimeType",
      "sha256",
      "retryOfId",
      "coverSource",
    ]
  ) {
    assert.equal(Object.hasOwn(record, key), false, `${key} must not be serialized`);
  }
  assert.doesNotMatch(JSON.stringify(record), /\/data\//);
}

Deno.test("Hono API exposes health and public capability configuration without a key", async () => {
  const { app, repository } = setup();
  try {
    const health = await app.request("/api/health");
    assert.equal(health.status, 200);
    assert.deepEqual(await json(health), { status: "ok" });

    const response = await app.request("/api/config");
    assert.equal(response.status, 200);
    assert.deepEqual(await json<AppConfig>(response), {
      apiKeyConfigured: false,
      defaultModel: "music-3.0-free",
      availableModels: ["music-3.0-free", "music-3.0"],
      availableTrackModels: ["music-3.0-free", "music-3.0"],
      availableCoverModels: ["music-cover-free", "music-cover"],
      freeRateLimitRpm: 3,
    });
  } finally {
    repository.close();
  }
});

Deno.test("Hono API reports configured key state", async () => {
  const { app, repository } = setup({ config: { minimaxApiKey: "configured" } });
  try {
    assert.equal((await json<AppConfig>(await app.request("/api/config"))).apiKeyConfigured, true);
  } finally {
    repository.close();
  }
});

Deno.test("tenant middleware ignores headers by default and permits validated headers when enabled", async () => {
  const first = setup();
  try {
    const created = await first.app.request(
      "/api/generations",
      jsonRequest("POST", makeInput(), { "x-tenant-id": "tenant-requested" }),
    );
    assert.equal(created.status, 202);
    assert.ok(first.repository.getById("tenant-default", "generated-id"));
    assert.equal(first.repository.getById("tenant-requested", "generated-id"), null);
  } finally {
    first.repository.close();
  }

  const second = setup({ config: { allowTenantHeader: true } });
  try {
    const created = await second.app.request(
      "/api/generations",
      jsonRequest("POST", makeInput(), { "x-tenant-id": "tenant-requested" }),
    );
    assert.equal(created.status, 202);
    assert.ok(second.repository.getById("tenant-requested", "generated-id"));
  } finally {
    second.repository.close();
  }

  const third = setup({ config: { allowTenantHeader: true } });
  try {
    assert.equal((await third.app.request("/api/generations")).status, 200);
  } finally {
    third.repository.close();
  }
});

Deno.test("tenant middleware returns safe errors for invalid requested and configured tenants", async () => {
  const requested = setup({ config: { allowTenantHeader: true } });
  try {
    const response = await requested.app.request("/api/generations", {
      headers: { "x-tenant-id": "../escape" },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await json(response), {
      error: { code: "invalid_tenant", message: "The tenant identifier is invalid." },
    });
  } finally {
    requested.repository.close();
  }

  const configured = setup({ config: { defaultTenantId: "invalid tenant" } });
  try {
    assert.equal((await configured.app.request("/api/health")).status, 400);
  } finally {
    configured.repository.close();
  }
});

Deno.test("generation creation validates JSON and settings before enqueueing", async () => {
  const { app, repository, runner } = setup();
  try {
    const invalidJson = await app.request("/api/generations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(invalidJson.status, 400);
    assert.equal((await json<{ error: { code: string } }>(invalidJson)).error.code, "invalid_json");

    const invalidSettings = await app.request(
      "/api/generations",
      jsonRequest("POST", { ...makeInput(), lyrics: "" }),
    );
    assert.equal(invalidSettings.status, 422);
    assert.equal(
      (await json<{ error: { fields: Record<string, string> } }>(invalidSettings)).error.fields
        .lyrics,
      "Add lyrics or enable automatic lyrics.",
    );
    assert.deepEqual(runner.calls, []);

    const success = await app.request("/api/generations", jsonRequest("POST", makeInput()));
    const generation = await json<Generation>(success);
    assert.equal(success.status, 202);
    assert.equal(generation.id, "generated-id");
    assert.equal(generation.status, "queued");
    assertPublicGeneration(generation);
    assert.deepEqual(runner.calls, [{ tenantId: "tenant-default", id: "generated-id" }]);
  } finally {
    repository.close();
  }
});

Deno.test("generation creation exercises default timestamp and UUID factories", async () => {
  const { app, repository, runner } = setup({ useDefaultFactories: true });
  try {
    const response = await app.request("/api/generations", jsonRequest("POST", makeInput()));
    const generation = await json<Generation>(response);
    assert.equal(response.status, 202);
    assert.match(generation.id, /^[0-9a-f-]{36}$/);
    assert.ok(Number.isFinite(Date.parse(generation.createdAt)));
    assert.equal(runner.calls[0]?.id, generation.id);
  } finally {
    repository.close();
  }
});

Deno.test("generation list applies query/status/limit filters and rejects malformed filters", async () => {
  const { app, repository } = setup();
  try {
    repository.create("tenant-default", makeInput({ title: "Neon one" }), NOW, "one");
    repository.create("tenant-default", makeInput({ title: "Other" }), NOW, "two");
    repository.markFailed("tenant-default", "one", "failed", "failed", NOW);

    const response = await app.request("/api/generations?q=neon&status=failed&limit=1");
    assert.equal(response.status, 200);
    const list = await json<GenerationListResponse>(response);
    assert.equal(list.total, 1);
    assert.deepEqual(list.items.map((item) => item.id), ["one"]);
    assertPublicGeneration(list.items[0]);

    const offset = await app.request("/api/generations?limit=1&offset=1");
    assert.equal(offset.status, 200);
    const offsetPage = await json<GenerationListResponse>(offset);
    assert.equal(offsetPage.total, 2);
    assert.deepEqual(offsetPage.items.map((item) => item.id), ["one"]);

    const invalid = await app.request("/api/generations?limit=0");
    assert.equal(invalid.status, 422);
    assert.equal((await json<{ error: { code: string } }>(invalid)).error.code, "validation_error");

    const invalidOffset = await app.request("/api/generations?offset=-1");
    assert.equal(invalidOffset.status, 422);
    assert.equal(
      (await json<{ error: { code: string } }>(invalidOffset)).error.code,
      "validation_error",
    );
  } finally {
    repository.close();
  }
});

Deno.test("generation history exposes rows beyond the first one hundred", async () => {
  const { app, repository } = setup();
  try {
    for (let index = 0; index < 105; index += 1) {
      const id = `g-${String(index).padStart(3, "0")}`;
      repository.create("tenant-default", makeInput({ title: `Track ${index}` }), NOW, id);
    }

    const response = await app.request("/api/generations?limit=5&offset=100");
    assert.equal(response.status, 200);
    const page = await json<GenerationListResponse>(response);
    assert.equal(page.total, 105);
    assert.deepEqual(page.items.map((item) => item.id), [
      "g-004",
      "g-003",
      "g-002",
      "g-001",
      "g-000",
    ]);
    for (const item of page.items) assertPublicGeneration(item);
  } finally {
    repository.close();
  }
});

Deno.test("generation detail returns tenant data and a 404 for absent records", async () => {
  const { app, repository } = setup();
  try {
    repository.create("tenant-default", makeInput(), NOW, "detail");
    const found = await app.request("/api/generations/detail");
    assert.equal(found.status, 200);
    assert.equal((await json<Generation>(found)).id, "detail");

    const missing = await app.request("/api/generations/missing");
    assert.equal(missing.status, 404);
    assert.equal((await json<{ error: { code: string } }>(missing)).error.code, "not_found");
  } finally {
    repository.close();
  }
});

Deno.test("generation JSON never exposes tenant, storage, checksum, retry, or filesystem internals", async () => {
  const { app, repository } = setup();
  try {
    repository.create("tenant-default", makeInput({ title: "Private internals" }), NOW, "private");
    repository.markCompleted("tenant-default", "private", {
      audioPath: "/data/audio/tenant-default/private/audio.mp3",
      audioMimeType: "audio/mpeg",
      durationMs: 100,
      sizeBytes: 4,
      sha256: "private-checksum",
      traceId: "public-trace",
    }, NOW);

    const listed = await json<GenerationListResponse>(await app.request("/api/generations"));
    assert.equal(listed.items.length, 1);
    assertPublicGeneration(listed.items[0]);

    const detail = await json<Generation>(await app.request("/api/generations/private"));
    assertPublicGeneration(detail);
    assert.equal(detail.audioUrl, "/api/generations/private/audio");

    const patched = await json<Generation>(
      await app.request(
        "/api/generations/private",
        jsonRequest("PATCH", { title: "Public title" }),
      ),
    );
    assertPublicGeneration(patched);

    const retried = await json<Generation>(
      await app.request("/api/generations/private/retry", { method: "POST" }),
    );
    assertPublicGeneration(retried);
  } finally {
    repository.close();
  }
});

Deno.test("generation title update handles valid, invalid JSON, invalid title, and missing records", async () => {
  const { app, repository } = setup();
  try {
    repository.create("tenant-default", makeInput(), NOW, "rename");
    const renamed = await app.request(
      "/api/generations/rename",
      jsonRequest("PATCH", { title: "  New title  " }),
    );
    assert.equal(renamed.status, 200);
    assert.equal((await json<Generation>(renamed)).title, "New title");

    const malformed = await app.request("/api/generations/rename", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "bad-json",
    });
    assert.equal(malformed.status, 400);

    const invalid = await app.request(
      "/api/generations/rename",
      jsonRequest("PATCH", { title: "" }),
    );
    assert.equal(invalid.status, 422);

    const missing = await app.request(
      "/api/generations/missing",
      jsonRequest("PATCH", { title: "New" }),
    );
    assert.equal(missing.status, 404);
  } finally {
    repository.close();
  }
});

Deno.test("retry clones immutable generation parameters and links the new record", async () => {
  const { app, repository, runner } = setup();
  try {
    repository.create(
      "tenant-default",
      makeInput({
        title: "Original",
        model: "music-3.0",
        prompt: "Original prompt",
        lyrics: "Original lyrics",
        lyricsOptimizer: false,
        instrumental: false,
        audio: { sampleRate: 24000, bitrate: 64000, format: "wav" },
      }),
      NOW,
      "original",
    );

    const response = await app.request("/api/generations/original/retry", { method: "POST" });
    const retried = await json<Generation>(response);
    assert.equal(response.status, 202);
    assert.equal(retried.id, "generated-id");
    assert.equal(retried.title, "Original · retry");
    assert.equal(retried.model, "music-3.0");
    assert.equal(retried.prompt, "Original prompt");
    assert.equal(retried.lyrics, "Original lyrics");
    assert.deepEqual(retried.audio, { sampleRate: 24000, bitrate: 64000, format: "wav" });
    assertPublicGeneration(retried);
    assert.equal(repository.getById("tenant-default", "generated-id")?.retryOfId, "original");
    assert.deepEqual(runner.calls, [{ tenantId: "tenant-default", id: "generated-id" }]);

    const missing = await app.request("/api/generations/missing/retry", { method: "POST" });
    assert.equal(missing.status, 404);
  } finally {
    repository.close();
  }
});

Deno.test("lyric and cover preprocess endpoints validate, forward, and safely map failures", async () => {
  const { app, repository, provider } = setup();
  try {
    const lyrics = await app.request(
      "/api/lyrics",
      jsonRequest("POST", {
        mode: "edit",
        prompt: "Continue the bridge",
        lyrics: "Existing words",
        title: "Kept title",
      }),
    );
    assert.equal(lyrics.status, 200);
    assert.deepEqual(await json(lyrics), {
      songTitle: "Generated",
      styleTags: "Pop",
      lyrics: "[Verse]\nSong",
    });
    assert.deepEqual(provider.lyricsCalls, [{
      mode: "edit",
      prompt: "Continue the bridge",
      lyrics: "Existing words",
      title: "Kept title",
    }]);

    const preprocess = await app.request(
      "/api/covers/preprocess",
      jsonRequest("POST", {
        source: { type: "url", url: "https://audio.example/song.mp3" },
      }),
    );
    assert.equal(preprocess.status, 200);
    assert.equal((await json<CoverPreprocessResult>(preprocess)).coverFeatureId, "feature-id");
    assert.deepEqual(provider.preprocessCalls, [{
      source: { type: "url", url: "https://audio.example/song.mp3" },
    }]);

    const invalid = await app.request(
      "/api/lyrics",
      jsonRequest("POST", { mode: "invalid" }),
    );
    assert.equal(invalid.status, 422);
    const malformed = await app.request("/api/covers/preprocess", {
      method: "POST",
      body: "{",
    });
    assert.equal(malformed.status, 400);

    provider.lyricsError = new ProviderError("1002", "Wait before trying again.");
    const providerFailure = await app.request(
      "/api/lyrics",
      jsonRequest("POST", { mode: "write_full_song" }),
    );
    assert.equal(providerFailure.status, 502);
    assert.deepEqual(await json(providerFailure), {
      error: { code: "1002", message: "Wait before trying again." },
    });

    provider.preprocessError = new Error("private socket detail");
    const transport = await app.request(
      "/api/covers/preprocess",
      jsonRequest("POST", {
        source: { type: "base64", data: "SUQz" },
      }),
    );
    assert.equal(transport.status, 502);
    assert.deepEqual(await json(transport), {
      error: {
        code: "transport_error",
        message: "MiniMax could not complete the request. Try again.",
      },
    });

    provider.preprocessError = 42;
    const unknown = await app.request(
      "/api/covers/preprocess",
      jsonRequest("POST", {
        source: { type: "base64", data: "SUQz" },
      }),
    );
    assert.equal((await json<{ error: { code: string } }>(unknown)).error.code, "unknown_error");
  } finally {
    repository.close();
  }
});

Deno.test("cover generations and retries keep private durable sources out of JSON", async () => {
  const { app, repository, runner } = setup();
  try {
    const response = await app.request(
      "/api/generations",
      jsonRequest("POST", {
        title: "Fresh cover",
        model: "music-cover-free",
        prompt: "Smooth late-night jazz cover",
        source: { type: "base64", data: "SUQz" },
        audio: { sampleRate: 44100, bitrate: 256000, format: "mp3" },
      }),
    );
    assert.equal(response.status, 202);
    const created = await json<Generation>(response);
    assert.equal(created.kind, "cover");
    assert.equal(created.model, "music-cover-free");
    assert.equal(Object.hasOwn(created, "source"), false);
    assertPublicGeneration(created);
    assert.equal(repository.getById("tenant-default", created.id)?.coverSource, null);
    assert.deepEqual(repository.getByIdWithSource("tenant-default", created.id)?.coverSource, {
      type: "base64",
      data: "SUQz",
    });
    repository.delete("tenant-default", created.id);

    repository.create(
      "tenant-default",
      {
        title: "Original cover",
        model: "music-cover",
        prompt: "Energetic orchestral cover",
        lyrics: "Edited orchestral lyrics",
        source: { type: "feature", featureId: "feature-id" },
        audio: { sampleRate: 24000, bitrate: 64000, format: "wav" },
      },
      NOW,
      "cover-original",
    );
    const retry = await app.request("/api/generations/cover-original/retry", { method: "POST" });
    assert.equal(retry.status, 202);
    const retried = await json<Generation>(retry);
    assert.equal(retried.title, "Original cover · retry");
    assert.deepEqual(repository.getByIdWithSource("tenant-default", retried.id)?.coverSource, {
      type: "feature",
      featureId: "feature-id",
    });
    assert.equal(runner.calls.length, 2);
    repository.delete("tenant-default", retried.id);

    repository.create(
      "tenant-default",
      {
        title: "ASR cover",
        model: "music-cover",
        prompt: "Acoustic late-night cover",
        source: { type: "url", url: "https://audio.example/asr.mp3" },
        audio: { sampleRate: 44100, bitrate: 256000, format: "mp3" },
      },
      NOW,
      "asr-cover",
    );
    const asrRetry = await app.request("/api/generations/asr-cover/retry", { method: "POST" });
    assert.equal((await json<Generation>(asrRetry)).lyrics, "");

    repository.create(
      "tenant-default",
      {
        title: "Missing cover source",
        model: "music-cover",
        prompt: "Energetic orchestral cover",
        source: { type: "url", url: "https://audio.example/song.mp3" },
        audio: { sampleRate: 44100, bitrate: 256000, format: "mp3" },
      },
      NOW,
      "missing-cover-source",
    );
    const originalGet = repository.getByIdWithSource.bind(repository);
    repository.getByIdWithSource = (tenantId, id) => {
      const record = originalGet(tenantId, id);
      return record && id === "missing-cover-source" ? { ...record, coverSource: null } : record;
    };
    const missing = await app.request("/api/generations/missing-cover-source/retry", {
      method: "POST",
    });
    assert.equal(missing.status, 409);
    assert.equal(
      (await json<{ error: { code: string } }>(missing)).error.code,
      "cover_source_missing",
    );
  } finally {
    repository.close();
  }
});

Deno.test("generation deletion rejects active work and removes terminal metadata and audio", async () => {
  const { app, repository, storage } = setup();
  try {
    assert.equal((await app.request("/api/generations/missing", { method: "DELETE" })).status, 404);

    repository.create("tenant-default", makeInput(), NOW, "active");
    assert.equal((await app.request("/api/generations/active", { method: "DELETE" })).status, 409);
    repository.markGenerating("tenant-default", "active", NOW);
    assert.equal((await app.request("/api/generations/active", { method: "DELETE" })).status, 409);

    repository.create("tenant-default", makeInput(), NOW, "failed");
    repository.markFailed("tenant-default", "failed", "x", "failed", NOW);
    const failed = await app.request("/api/generations/failed", { method: "DELETE" });
    assert.equal(failed.status, 204);
    assert.equal(repository.getById("tenant-default", "failed"), null);

    repository.create("tenant-default", makeInput(), NOW, "completed");
    repository.create("tenant-default", makeInput(), NOW, "child", "completed");
    repository.markCompleted("tenant-default", "completed", {
      audioPath: "/memory/completed",
      audioMimeType: "audio/mpeg",
      durationMs: 100,
      sizeBytes: 3,
      sha256: "hash",
      traceId: null,
    }, NOW);
    storage.files.set("/memory/completed", MP3_BYTES);
    const completed = await app.request("/api/generations/completed", { method: "DELETE" });
    assert.equal(completed.status, 204);
    assert.deepEqual(storage.deleted, ["/memory/completed"]);
    assert.equal(repository.getById("tenant-default", "completed"), null);
    assert.equal(repository.getById("tenant-default", "child")?.retryOfId, null);

    repository.create("tenant-default", makeInput(), NOW, "delete-error");
    repository.markCompleted("tenant-default", "delete-error", {
      audioPath: "/memory/delete-error",
      audioMimeType: "audio/mpeg",
      durationMs: null,
      sizeBytes: 1,
      sha256: "hash",
      traceId: null,
    }, NOW);
    storage.deleteError = new Error("private storage detail");
    const broken = await app.request("/api/generations/delete-error", { method: "DELETE" });
    assert.equal(broken.status, 500);
    assert.ok(repository.getById("tenant-default", "delete-error"));
  } finally {
    repository.close();
  }
});

Deno.test("audio endpoint serves full and partial tenant-authorized audio", async () => {
  const { app, repository, storage } = setup();
  try {
    repository.create("tenant-default", makeInput(), NOW, "audio");
    repository.markCompleted("tenant-default", "audio", {
      audioPath: "/memory/audio",
      audioMimeType: "audio/mpeg",
      durationMs: 1000,
      sizeBytes: 6,
      sha256: "hash",
      traceId: null,
    }, NOW);
    storage.files.set("/memory/audio", new Uint8Array([0, 1, 2, 3, 4, 5]));

    const full = await app.request("/api/generations/audio/audio");
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("accept-ranges"), "bytes");
    assert.equal(full.headers.get("cache-control"), "private, max-age=3600");
    assert.equal(
      full.headers.get("content-disposition"),
      `inline; filename="Midnight Current.mp3"; filename*=UTF-8''Midnight%20Current.mp3`,
    );
    assert.equal(full.headers.get("content-type"), "audio/mpeg");
    assert.equal(full.headers.get("content-length"), "6");
    assert.equal(full.headers.get("etag"), '"hash"');
    assert.deepEqual(new Uint8Array(await full.arrayBuffer()), new Uint8Array([0, 1, 2, 3, 4, 5]));

    const partial = await app.request("/api/generations/audio/audio", {
      headers: { range: "bytes=2-4" },
    });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get("content-range"), "bytes 2-4/6");
    assert.equal(partial.headers.get("content-length"), "3");
    assert.equal(
      partial.headers.get("content-disposition"),
      full.headers.get("content-disposition"),
    );
    assert.equal(partial.headers.get("etag"), '"hash"');
    assert.deepEqual(new Uint8Array(await partial.arrayBuffer()), new Uint8Array([2, 3, 4]));

    const matchedIfRange = await app.request("/api/generations/audio/audio", {
      headers: { range: "bytes=1-2", "if-range": '"hash"' },
    });
    assert.equal(matchedIfRange.status, 206);
    assert.deepEqual(new Uint8Array(await matchedIfRange.arrayBuffer()), new Uint8Array([1, 2]));

    const staleIfRange = await app.request("/api/generations/audio/audio", {
      headers: { range: "bytes=1-2", "if-range": '"stale"' },
    });
    assert.equal(staleIfRange.status, 200);
    assert.deepEqual(
      new Uint8Array(await staleIfRange.arrayBuffer()),
      new Uint8Array([0, 1, 2, 3, 4, 5]),
    );

    const invalid = await app.request("/api/generations/audio/audio", {
      headers: { range: "bytes=99-" },
    });
    assert.equal(invalid.status, 416);
    assert.equal(
      (await json<{ error: { code: string } }>(invalid)).error.code,
      "range_not_satisfiable",
    );
    assert.equal(invalid.headers.get("content-range"), "bytes */6");

    repository.create("tenant-default", makeInput(), NOW, "audio-without-etag");
    repository.markCompleted("tenant-default", "audio-without-etag", {
      audioPath: "/memory/no-etag",
      audioMimeType: "audio/mpeg",
      durationMs: null,
      sizeBytes: 3,
      sha256: "",
      traceId: null,
    }, NOW);
    storage.files.set("/memory/no-etag", new Uint8Array([6, 7, 8]));
    const noEtag = await app.request("/api/generations/audio-without-etag/audio", {
      headers: { range: "bytes=0-1", "if-range": '"anything"' },
    });
    assert.equal(noEtag.status, 206);
    assert.equal(noEtag.headers.get("etag"), null);
    assert.deepEqual(new Uint8Array(await noEtag.arrayBuffer()), new Uint8Array([6, 7]));
  } finally {
    repository.close();
  }
});

Deno.test("audioContentDisposition sanitizes fallback and UTF-8 filenames", () => {
  assert.equal(
    audioContentDisposition('Café / "Night"', "wav"),
    `inline; filename="Caf_ _ _Night_.wav"; filename*=UTF-8''Caf%C3%A9%20_%20_Night_.wav`,
  );
  assert.equal(
    audioContentDisposition("Broken \uD800 title", "mp3"),
    `inline; filename="Broken _ title.mp3"; filename*=UTF-8''Broken%20%EF%BF%BD%20title.mp3`,
  );
});

Deno.test("audio endpoint rejects absent metadata and masks storage failures", async () => {
  const { app, repository, storage } = setup();
  try {
    assert.equal((await app.request("/api/generations/missing/audio")).status, 404);

    repository.create("tenant-default", makeInput(), NOW, "queued");
    assert.equal((await app.request("/api/generations/queued/audio")).status, 404);

    repository.create("tenant-default", makeInput(), NOW, "missing-mime");
    repository.markCompleted("tenant-default", "missing-mime", {
      audioPath: "/memory/no-mime",
      audioMimeType: "",
      durationMs: null,
      sizeBytes: 1,
      sha256: "hash",
      traceId: null,
    }, NOW);
    assert.equal((await app.request("/api/generations/missing-mime/audio")).status, 404);

    repository.create("tenant-default", makeInput(), NOW, "broken-storage");
    repository.markCompleted("tenant-default", "broken-storage", {
      audioPath: "/memory/broken",
      audioMimeType: "audio/mpeg",
      durationMs: null,
      sizeBytes: 1,
      sha256: "hash",
      traceId: null,
    }, NOW);
    storage.readError = new Error("private filesystem detail");
    const broken = await app.request("/api/generations/broken-storage/audio");
    assert.equal(broken.status, 500);
    assert.deepEqual(await json(broken), {
      error: { code: "internal_error", message: "Something went wrong." },
    });
  } finally {
    repository.close();
  }
});

Deno.test("Hono API returns a JSON 404 for unknown routes", async () => {
  const { app, repository } = setup();
  try {
    const response = await app.request("/not-an-api-route");
    assert.equal(response.status, 404);
    assert.deepEqual(await json(response), {
      error: { code: "not_found", message: "Route not found." },
    });
  } finally {
    repository.close();
  }
});
