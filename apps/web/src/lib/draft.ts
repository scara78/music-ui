import { type CreateGenerationInput, DEFAULT_GENERATION_INPUT, type Generation } from "@contracts";

export type ComposerMode = "quick" | "custom";
export type LyricsMode = "auto" | "write";

export function freshDraft(
  defaultModel = DEFAULT_GENERATION_INPUT.model,
): CreateGenerationInput {
  return {
    ...DEFAULT_GENERATION_INPUT,
    model: defaultModel,
    audio: { ...DEFAULT_GENERATION_INPUT.audio },
  };
}

export function draftFromGeneration(
  generation: Generation,
): CreateGenerationInput {
  return {
    title: generation.title,
    model: generation.model as CreateGenerationInput["model"],
    prompt: generation.prompt,
    lyrics: generation.lyrics,
    lyricsOptimizer: generation.lyricsOptimizer,
    instrumental: generation.instrumental,
    audio: { ...generation.audio },
  };
}

export function validateDraft(draft: CreateGenerationInput): string | null {
  if (draft.instrumental) {
    return draft.prompt.trim() ? null : "Describe the instrumental you want to make.";
  }
  if (draft.lyricsOptimizer) {
    return draft.prompt.trim() ? null : "Describe the song so MiniMax can write its lyrics.";
  }
  return draft.lyrics.trim() ? null : "Add lyrics or switch to Auto lyrics.";
}

export function setInstrumental(
  draft: CreateGenerationInput,
  instrumental: boolean,
): CreateGenerationInput {
  return {
    ...draft,
    instrumental,
    lyrics: instrumental ? "" : draft.lyrics,
    lyricsOptimizer: instrumental ? false : draft.lyricsOptimizer,
  };
}

export function setLyricsMode(
  draft: CreateGenerationInput,
  mode: LyricsMode,
): CreateGenerationInput {
  return {
    ...draft,
    lyrics: mode === "auto" ? "" : draft.lyrics,
    lyricsOptimizer: mode === "auto",
    instrumental: false,
  };
}
