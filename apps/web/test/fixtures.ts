import type { AppConfig, Generation } from "@contracts";

export const configuredApp: AppConfig = {
  apiKeyConfigured: true,
  defaultModel: "music-3.0-free",
  availableModels: ["music-3.0-free", "music-3.0"],
  availableTrackModels: ["music-3.0-free", "music-3.0"],
  availableCoverModels: ["music-cover-free", "music-cover"],
  freeRateLimitRpm: 3,
};

export function generation(overrides: Partial<Generation> = {}): Generation {
  return {
    id: "gen-1",
    kind: "track",
    title: "Midnight Signal",
    model: "music-3.0-free",
    prompt: "Nocturnal synth pop",
    lyrics: "[Verse]\nUnder city lights",
    lyricsOptimizer: false,
    instrumental: false,
    audio: { sampleRate: 44100, bitrate: 256000, format: "mp3" },
    status: "completed",
    durationMs: 125_400,
    sizeBytes: 2_500_000,
    traceId: "trace-1",
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-08-11T10:00:00.000Z",
    updatedAt: "2026-08-11T10:02:00.000Z",
    completedAt: "2026-08-11T10:02:00.000Z",
    audioUrl: "/api/generations/gen-1/audio",
    ...overrides,
  };
}
