import { TRACK_MODELS, type TrackModel } from "@contracts/index.ts";

export interface ApiConfig {
  port: number;
  host: string;
  databasePath: string;
  audioStoragePath: string;
  defaultTenantId: string;
  allowTenantHeader: boolean;
  minimaxApiKey: string;
  minimaxBaseUrl: string;
  defaultModel: TrackModel;
  freeRateLimitRpm: number;
}

export type EnvReader = (name: string) => string | undefined;

function requirePositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true";
}

function readModel(value: string | undefined): TrackModel {
  const model = value ?? "music-3.0-free";
  if (!TRACK_MODELS.includes(model as TrackModel)) {
    throw new Error(`MINIMAX_MODEL must be one of: ${TRACK_MODELS.join(", ")}`);
  }
  return model as TrackModel;
}

export function loadConfig(
  read: EnvReader = (name) => Deno.env.get(name),
): ApiConfig {
  return {
    port: requirePositiveInteger(read("API_PORT"), 8787, "API_PORT"),
    host: read("API_HOST") ?? "127.0.0.1",
    databasePath: read("DATABASE_PATH") ?? "./data/music.db",
    audioStoragePath: read("AUDIO_STORAGE_PATH") ?? "./data/audio",
    defaultTenantId: read("DEFAULT_TENANT_ID") ?? "local-user",
    allowTenantHeader: readBoolean(read("ALLOW_TENANT_HEADER"), false),
    minimaxApiKey: read("MINIMAX_API_KEY") ?? "",
    minimaxBaseUrl: (read("MINIMAX_BASE_URL") ?? "https://api.minimax.io")
      .replace(/\/$/, ""),
    defaultModel: readModel(read("MINIMAX_MODEL")),
    freeRateLimitRpm: 3,
  };
}
