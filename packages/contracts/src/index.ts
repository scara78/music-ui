export const TRACK_MODELS = [
  "music-3.0-free",
  "music-3.0",
] as const;

/** @deprecated Use TRACK_MODELS for text-to-music composer choices. */
export const MUSIC_MODELS = TRACK_MODELS;

export const COVER_MODELS = [
  "music-cover-free",
  "music-cover",
] as const;

export const GENERATION_MODELS = [...TRACK_MODELS, ...COVER_MODELS] as const;
export const LYRICS_GENERATION_MODES = ["write_full_song", "edit"] as const;

export const SAMPLE_RATES = [16000, 24000, 32000, 44100] as const;
export const BITRATES = [32000, 64000, 128000, 256000] as const;
export const AUDIO_FORMATS = ["mp3", "wav", "pcm"] as const;
export const GENERATION_STATUSES = [
  "queued",
  "generating",
  "completed",
  "failed",
] as const;

export type TrackModel = (typeof TRACK_MODELS)[number];
/** @deprecated Use TrackModel for text-to-music models. */
export type MusicModel = TrackModel;
export type CoverModel = (typeof COVER_MODELS)[number];
export type GenerationModel = (typeof GENERATION_MODELS)[number];
export type LyricsGenerationMode = (typeof LYRICS_GENERATION_MODES)[number];
export type SampleRate = (typeof SAMPLE_RATES)[number];
export type Bitrate = (typeof BITRATES)[number];
export type AudioFormat = (typeof AUDIO_FORMATS)[number];
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

export interface AudioSettings {
  sampleRate: SampleRate;
  bitrate: Bitrate;
  format: AudioFormat;
}

export interface CreateGenerationInput {
  title?: string | undefined;
  model: TrackModel;
  prompt: string;
  lyrics: string;
  lyricsOptimizer: boolean;
  instrumental: boolean;
  audio: AudioSettings;
}

export interface CoverUrlSource {
  type: "url";
  url: string;
}

export interface CoverBase64Source {
  type: "base64";
  data: string;
}

export interface CoverFeatureSource {
  type: "feature";
  featureId: string;
}

export type CoverDirectSource = CoverUrlSource | CoverBase64Source;
export type CoverGenerationSource = CoverDirectSource | CoverFeatureSource;

export interface CreateCoverGenerationInput {
  title?: string | undefined;
  model: CoverModel;
  prompt: string;
  lyrics?: string | undefined;
  source: CoverGenerationSource;
  audio: AudioSettings;
}

export type CreateAnyGenerationInput = CreateGenerationInput | CreateCoverGenerationInput;

export interface GenerateLyricsInput {
  mode: LyricsGenerationMode;
  prompt?: string | undefined;
  lyrics?: string | undefined;
  title?: string | undefined;
}

export interface GenerateLyricsResult {
  songTitle: string;
  styleTags: string;
  lyrics: string;
}

export interface CoverPreprocessInput {
  source: CoverDirectSource;
}

export interface CoverPreprocessResult {
  coverFeatureId: string;
  formattedLyrics: string;
  structureResult: string;
  audioDuration: number;
  traceId: string | null;
}

export interface Generation {
  id: string;
  kind: "track" | "cover";
  title: string;
  model: GenerationModel;
  prompt: string;
  lyrics: string;
  lyricsOptimizer: boolean;
  instrumental: boolean;
  audio: AudioSettings;
  status: GenerationStatus;
  durationMs: number | null;
  sizeBytes: number | null;
  traceId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  audioUrl: string | null;
}

export interface GenerationListResponse {
  items: Generation[];
  total: number;
}

export interface AppConfig {
  apiKeyConfigured: boolean;
  defaultModel: TrackModel;
  availableModels: readonly TrackModel[];
  availableTrackModels: readonly TrackModel[];
  availableCoverModels: readonly CoverModel[];
  freeRateLimitRpm: number;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

export interface UpdateGenerationInput {
  title: string;
}

export const DEFAULT_GENERATION_INPUT: CreateGenerationInput = {
  model: "music-3.0-free",
  prompt: "",
  lyrics: "",
  lyricsOptimizer: true,
  instrumental: false,
  audio: {
    sampleRate: 44100,
    bitrate: 256000,
    format: "mp3",
  },
};

export function isActiveStatus(status: GenerationStatus): boolean {
  return status === "queued" || status === "generating";
}
