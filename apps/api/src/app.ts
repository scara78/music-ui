import { Hono } from "hono";
import {
  COVER_MODELS,
  type CreateAnyGenerationInput,
  type Generation,
  TRACK_MODELS,
} from "@contracts/index.ts";
import type { ApiConfig } from "./config.ts";
import { AppError, describeProviderError, toApiError } from "./errors.ts";
import type { MusicProvider } from "./minimax.ts";
import type { GenerationRepository, InternalGeneration } from "./repository.ts";
import type { GenerationRunner } from "./runner.ts";
import type { AudioStorage } from "./storage.ts";
import { parseByteRange } from "./range.ts";
import {
  parseCoverPreprocess,
  parseCreateGeneration,
  parseGenerateLyrics,
  parseListFilters,
  parseTitle,
  validateTenantId,
} from "./validation.ts";

interface Variables {
  tenantId: string;
}

export interface AppDependencies {
  config: Pick<
    ApiConfig,
    | "allowTenantHeader"
    | "defaultTenantId"
    | "defaultModel"
    | "freeRateLimitRpm"
    | "minimaxApiKey"
  >;
  repository: GenerationRepository;
  runner: GenerationRunner;
  storage: AudioStorage;
  provider: Pick<MusicProvider, "generateLyrics" | "preprocessCover">;
  now?: () => string;
  id?: () => string;
}

function toInput(record: InternalGeneration): CreateAnyGenerationInput {
  if (record.kind === "cover") {
    if (!record.coverSource) {
      throw new AppError(
        409,
        "cover_source_missing",
        "The cover reference is no longer available.",
      );
    }
    return {
      title: `${record.title} · retry`,
      model: record.model as "music-cover-free" | "music-cover",
      prompt: record.prompt,
      lyrics: record.lyrics || undefined,
      source: record.coverSource,
      audio: record.audio,
    };
  }
  return {
    title: `${record.title} · retry`,
    model: record.model as "music-3.0-free" | "music-3.0",
    prompt: record.prompt,
    lyrics: record.lyrics,
    lyricsOptimizer: record.lyricsOptimizer,
    instrumental: record.instrumental,
    audio: record.audio,
  };
}

function toPublicGeneration(record: InternalGeneration): Generation {
  const {
    tenantId: _tenantId,
    audioPath: _audioPath,
    audioMimeType: _audioMimeType,
    sha256: _sha256,
    retryOfId: _retryOfId,
    coverSource: _coverSource,
    ...generation
  } = record;
  return generation;
}

function providerAppError(error: unknown): AppError {
  const failure = describeProviderError(error);
  const message = failure.code === "transport_error" || failure.code === "unknown_error"
    ? "MiniMax could not complete the request. Try again."
    : failure.message;
  return new AppError(502, failure.code, message);
}

export function audioContentDisposition(title: string, format: string): string {
  const filename = `${title.toWellFormed().replace(/[\p{Cc}"\\/:*?<>|]/gu, "_")}.${format}`;
  const fallback = filename.replace(/[^\x20-\x7e]/g, "_");
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError(400, "invalid_json", "Request body must be valid JSON.");
  }
}

export function createApp(
  dependencies: AppDependencies,
): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>();
  const now = dependencies.now ?? (() => new Date().toISOString());
  const nextId = dependencies.id ?? (() => crypto.randomUUID());

  app.onError((error, context) => {
    const response = toApiError(error);
    return context.json(
      response.body,
      response.status as 400 | 404 | 409 | 416 | 422 | 500 | 502,
      response.headers,
    );
  });

  app.use("/api/*", async (context, next) => {
    const requested = context.req.header("x-tenant-id");
    const tenantId = dependencies.config.allowTenantHeader && requested
      ? validateTenantId(requested)
      : validateTenantId(dependencies.config.defaultTenantId);
    context.set("tenantId", tenantId);
    await next();
  });

  app.get("/api/health", (context) => context.json({ status: "ok" }));

  app.get("/api/config", (context) =>
    context.json({
      apiKeyConfigured: dependencies.config.minimaxApiKey.length > 0,
      defaultModel: dependencies.config.defaultModel,
      availableModels: TRACK_MODELS,
      availableTrackModels: TRACK_MODELS,
      availableCoverModels: COVER_MODELS,
      freeRateLimitRpm: dependencies.config.freeRateLimitRpm,
    }));

  app.post("/api/lyrics", async (context) => {
    const input = parseGenerateLyrics(await readJson(context.req.raw));
    try {
      return context.json(await dependencies.provider.generateLyrics(input));
    } catch (error) {
      throw providerAppError(error);
    }
  });

  app.post("/api/covers/preprocess", async (context) => {
    const input = parseCoverPreprocess(await readJson(context.req.raw));
    try {
      return context.json(await dependencies.provider.preprocessCover(input));
    } catch (error) {
      throw providerAppError(error);
    }
  });

  app.get("/api/generations", (context) => {
    const filters = parseListFilters(new URL(context.req.url));
    const result = dependencies.repository.list(
      context.get("tenantId"),
      filters,
    );
    return context.json({
      items: result.items.map(toPublicGeneration),
      total: result.total,
    });
  });

  app.post("/api/generations", async (context) => {
    const input = parseCreateGeneration(await readJson(context.req.raw));
    const tenantId = context.get("tenantId");
    const generation = dependencies.repository.create(
      tenantId,
      input,
      now(),
      nextId(),
    );
    dependencies.runner.enqueue(tenantId, generation.id);
    return context.json(toPublicGeneration(generation), 202);
  });

  app.get("/api/generations/:id", (context) => {
    const generation = dependencies.repository.getById(
      context.get("tenantId"),
      context.req.param("id"),
    );
    if (!generation) {
      throw new AppError(404, "not_found", "Generation not found.");
    }
    return context.json(toPublicGeneration(generation));
  });

  app.patch("/api/generations/:id", async (context) => {
    const title = parseTitle(await readJson(context.req.raw));
    const generation = dependencies.repository.updateTitle(
      context.get("tenantId"),
      context.req.param("id"),
      title,
      now(),
    );
    if (!generation) {
      throw new AppError(404, "not_found", "Generation not found.");
    }
    return context.json(toPublicGeneration(generation));
  });

  app.delete("/api/generations/:id", async (context) => {
    const tenantId = context.get("tenantId");
    const generation = dependencies.repository.getById(
      tenantId,
      context.req.param("id"),
    );
    if (!generation) {
      throw new AppError(404, "not_found", "Generation not found.");
    }
    if (generation.status === "queued" || generation.status === "generating") {
      throw new AppError(
        409,
        "generation_active",
        "Wait for the active generation to finish before removing it.",
      );
    }
    if (generation.audioPath) {
      await dependencies.storage.delete(generation.audioPath);
    }
    dependencies.repository.delete(tenantId, generation.id);
    return context.body(null, 204);
  });

  app.post("/api/generations/:id/retry", (context) => {
    const tenantId = context.get("tenantId");
    const original = dependencies.repository.getByIdWithSource(
      tenantId,
      context.req.param("id"),
    );
    if (!original) {
      throw new AppError(404, "not_found", "Generation not found.");
    }
    const generation = dependencies.repository.create(
      tenantId,
      toInput(original),
      now(),
      nextId(),
      original.id,
    );
    dependencies.runner.enqueue(tenantId, generation.id);
    return context.json(toPublicGeneration(generation), 202);
  });

  app.get("/api/generations/:id/audio", async (context) => {
    const generation = dependencies.repository.getById(
      context.get("tenantId"),
      context.req.param("id"),
    );
    if (!generation?.audioPath || !generation.audioMimeType) {
      throw new AppError(
        404,
        "audio_not_found",
        "Audio is not available for this generation.",
      );
    }
    const bytes = await dependencies.storage.read(generation.audioPath);
    const etag = generation.sha256 ? `"${generation.sha256}"` : undefined;
    const requestedRange = context.req.header("range") ?? null;
    const ifRange = context.req.header("if-range");
    const range = ifRange && etag && ifRange !== etag
      ? null
      : parseByteRange(requestedRange, bytes.byteLength);
    const commonHeaders = {
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=3600",
      "content-disposition": audioContentDisposition(
        generation.title,
        generation.audio.format,
      ),
      "content-type": generation.audioMimeType,
      ...(etag ? { etag } : {}),
    };
    if (!range) {
      return new Response(Uint8Array.from(bytes).buffer, {
        headers: {
          ...commonHeaders,
          "content-length": String(bytes.byteLength),
        },
      });
    }
    const body = bytes.slice(range.start, range.end + 1);
    return new Response(Uint8Array.from(body).buffer, {
      status: 206,
      headers: {
        ...commonHeaders,
        "content-length": String(body.byteLength),
        "content-range": `bytes ${range.start}-${range.end}/${bytes.byteLength}`,
      },
    });
  });

  app.notFound((context) =>
    context.json(
      { error: { code: "not_found", message: "Route not found." } },
      404,
    )
  );
  return app;
}
