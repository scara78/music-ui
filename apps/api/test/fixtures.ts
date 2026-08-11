import type { AudioSettings, CreateGenerationInput } from "@contracts/index.ts";
import { AppError, ProviderError } from "../src/errors.ts";

export const NOW = "2026-08-11T12:00:00.000Z";
export const LATER = "2026-08-11T12:01:00.000Z";

type InputOverrides = Partial<Omit<CreateGenerationInput, "audio">> & {
  audio?: Partial<AudioSettings>;
};

export function makeInput(overrides: InputOverrides = {}): CreateGenerationInput {
  return {
    title: "Midnight Current",
    model: "music-3.0-free",
    prompt: "Dreamy synthwave with a patient build",
    lyrics: "[Verse]\nNeon on the water",
    lyricsOptimizer: false,
    instrumental: false,
    ...overrides,
    audio: {
      sampleRate: 44100,
      bitrate: 256000,
      format: "mp3",
      ...overrides.audio,
    },
  };
}

export function captureAppError(callback: () => unknown): AppError {
  try {
    callback();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("Expected AppError");
}

export async function captureAppErrorAsync(callback: () => Promise<unknown>): Promise<AppError> {
  try {
    await callback();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("Expected AppError");
}

export async function captureProviderError(
  callback: () => Promise<unknown>,
): Promise<ProviderError> {
  try {
    await callback();
  } catch (error) {
    if (error instanceof ProviderError) return error;
    throw error;
  }
  throw new Error("Expected ProviderError");
}
