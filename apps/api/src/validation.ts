import {
  AUDIO_FORMATS,
  BITRATES,
  COVER_MODELS,
  type CoverDirectSource,
  type CoverPreprocessInput,
  type CreateAnyGenerationInput,
  type CreateCoverGenerationInput,
  type CreateGenerationInput,
  type GenerateLyricsInput,
  GENERATION_STATUSES,
  type GenerationStatus,
  LYRICS_GENERATION_MODES,
  SAMPLE_RATES,
  TRACK_MODELS,
} from "@contracts/index.ts";
import { z } from "zod";
import { AppError } from "./errors.ts";

const audioSchema = z.object({
  sampleRate: z.union(SAMPLE_RATES.map((value) => z.literal(value))),
  bitrate: z.union(BITRATES.map((value) => z.literal(value))),
  format: z.enum(AUDIO_FORMATS),
}).strict();

const trackSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  model: z.enum(TRACK_MODELS),
  prompt: z.string().trim().max(2000),
  lyrics: z.string().trim().max(3500),
  lyricsOptimizer: z.boolean(),
  instrumental: z.boolean(),
  audio: audioSchema,
}).strict().superRefine((value, context) => {
  if (value.instrumental) {
    if (!value.prompt) {
      context.addIssue({ code: "custom", path: ["prompt"], message: "Describe the instrumental." });
    }
    if (value.lyrics) {
      context.addIssue({
        code: "custom",
        path: ["lyrics"],
        message: "Instrumentals cannot include lyrics.",
      });
    }
    if (value.lyricsOptimizer) {
      context.addIssue({
        code: "custom",
        path: ["lyricsOptimizer"],
        message: "Automatic lyrics cannot be used for an instrumental.",
      });
    }
    return;
  }

  if (value.lyricsOptimizer) {
    if (!value.prompt) {
      context.addIssue({
        code: "custom",
        path: ["prompt"],
        message: "Describe the song so MiniMax can write its lyrics.",
      });
    }
    if (value.lyrics) {
      context.addIssue({
        code: "custom",
        path: ["lyrics"],
        message: "Remove custom lyrics when automatic lyrics are enabled.",
      });
    }
  } else if (!value.lyrics) {
    context.addIssue({
      code: "custom",
      path: ["lyrics"],
      message: "Add lyrics or enable automatic lyrics.",
    });
  }
});

const httpUrl = z.string().trim().url().refine(
  (value) => value.startsWith("https://") || value.startsWith("http://"),
  "Reference audio URL must use HTTP or HTTPS.",
);

const base64 = z.string().trim().min(1).max(
  69_905_068,
  "Reference audio must be 50 MB or smaller.",
).regex(
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
  "Reference audio must be valid base64.",
);

const coverDirectSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("url"), url: httpUrl }).strict(),
  z.object({ type: z.literal("base64"), data: base64 }).strict(),
]);

const coverSourceSchema = z.discriminatedUnion("type", [
  ...coverDirectSourceSchema.options,
  z.object({ type: z.literal("feature"), featureId: z.string().trim().min(1) }).strict(),
]);

const coverSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  model: z.enum(COVER_MODELS),
  prompt: z.string().trim().min(10).max(300),
  lyrics: z.string().trim().max(1000).optional(),
  source: coverSourceSchema,
  audio: audioSchema,
}).strict().superRefine((value, context) => {
  if (value.lyrics !== undefined && value.lyrics.length < 10) {
    context.addIssue({
      code: "custom",
      path: ["lyrics"],
      message: "Cover lyrics must be between 10 and 1000 characters.",
    });
  }
  if (value.source.type === "feature" && value.lyrics === undefined) {
    context.addIssue({
      code: "custom",
      path: ["lyrics"],
      message: "Two-step covers require edited lyrics.",
    });
  }
});

const lyricsSchema = z.object({
  mode: z.enum(LYRICS_GENERATION_MODES),
  prompt: z.string().max(2000).optional(),
  lyrics: z.string().max(3500).optional(),
  title: z.string().optional(),
}).strict();

const coverPreprocessSchema = z.object({ source: coverDirectSourceSchema }).strict();

function fieldsFromZod(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "request";
    fields[path] ??= issue.message;
  }
  return fields;
}

export function parseCreateGeneration(value: CreateGenerationInput): CreateGenerationInput;
export function parseCreateGeneration(
  value: CreateCoverGenerationInput,
): CreateCoverGenerationInput;
export function parseCreateGeneration(value: unknown): CreateAnyGenerationInput;
export function parseCreateGeneration(value: unknown): CreateAnyGenerationInput {
  const model = typeof value === "object" && value !== null && "model" in value
    ? (value as { model?: unknown }).model
    : undefined;
  const result = typeof model === "string" && COVER_MODELS.includes(model as never)
    ? coverSchema.safeParse(value)
    : trackSchema.safeParse(value);
  if (!result.success) {
    throw new AppError(
      422,
      "validation_error",
      "Check the highlighted generation settings.",
      fieldsFromZod(result.error),
    );
  }
  return result.data;
}

export function parseGenerateLyrics(value: unknown): GenerateLyricsInput {
  const result = lyricsSchema.safeParse(value);
  if (!result.success) {
    throw new AppError(
      422,
      "validation_error",
      "Check the lyric generation settings.",
      fieldsFromZod(result.error),
    );
  }
  return result.data;
}

export function parseCoverPreprocess(value: unknown): CoverPreprocessInput {
  const result = coverPreprocessSchema.safeParse(value);
  if (!result.success) {
    throw new AppError(
      422,
      "validation_error",
      "Check the cover reference audio.",
      fieldsFromZod(result.error),
    );
  }
  return { source: result.data.source as CoverDirectSource };
}

export interface ListFilters {
  query: string;
  status?: GenerationStatus;
  limit: number;
  offset: number;
}

export function parseListFilters(url: URL): ListFilters {
  const query = (url.searchParams.get("q") ?? "").trim();
  if (query.length > 200) throw new AppError(422, "validation_error", "Search is too long.");

  const rawStatus = url.searchParams.get("status");
  if (rawStatus && !GENERATION_STATUSES.includes(rawStatus as GenerationStatus)) {
    throw new AppError(422, "validation_error", "Unknown generation status.");
  }

  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError(422, "validation_error", "Limit must be between 1 and 100.");
  }

  const rawOffset = url.searchParams.get("offset");
  const offset = rawOffset === null ? 0 : Number(rawOffset);
  if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) {
    throw new AppError(422, "validation_error", "Offset must be between 0 and 100000.");
  }

  return {
    query,
    status: rawStatus === null ? undefined : rawStatus as GenerationStatus,
    limit,
    offset,
  };
}

export function parseTitle(value: unknown): string {
  const result = z.object({ title: z.string().trim().min(1).max(80) }).strict().safeParse(value);
  if (!result.success) {
    throw new AppError(
      422,
      "validation_error",
      "Title must be between 1 and 80 characters.",
      fieldsFromZod(result.error),
    );
  }
  return result.data.title;
}

export function validateTenantId(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)) {
    throw new AppError(400, "invalid_tenant", "The tenant identifier is invalid.");
  }
  return value;
}
