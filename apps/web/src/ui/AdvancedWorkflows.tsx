import { type ChangeEvent, type SyntheticEvent, useId, useState } from "react";
import {
  AUDIO_FORMATS,
  type AudioFormat,
  type AudioSettings,
  type Bitrate,
  BITRATES,
  COVER_MODELS,
  type CoverDirectSource,
  type CoverGenerationSource,
  type CoverModel,
  type CoverPreprocessInput,
  type CoverPreprocessResult,
  type CreateCoverGenerationInput,
  type GenerateLyricsInput,
  type GenerateLyricsResult,
  type LyricsGenerationMode,
  SAMPLE_RATES,
  type SampleRate,
} from "@contracts";
import {
  ArrowRight,
  AudioLines,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  FileAudio,
  Link2,
  Music2,
  PencilLine,
  Sparkles,
  Upload,
  WandSparkles,
} from "lucide-react";
import "./advanced-workflows.css";

const MAX_REFERENCE_BYTES = 50 * 1024 * 1024;

export type AdvancedWorkflow = "lyrics" | "cover";
export type CoverWorkflowMode = "one_step" | "two_step";
export type ReferenceSourceMode = "url" | "file";

export interface LyricsWorkflowProps {
  onGenerate: (input: GenerateLyricsInput) => Promise<GenerateLyricsResult>;
  onApplyToSong: (result: GenerateLyricsResult) => void;
}

export interface CoverWorkflowProps {
  onPreprocess: (input: CoverPreprocessInput) => Promise<CoverPreprocessResult>;
  onGenerate: (input: CreateCoverGenerationInput) => Promise<unknown>;
}

export interface AdvancedWorkflowsProps {
  onGenerateLyrics: LyricsWorkflowProps["onGenerate"];
  onApplyLyricsToSong: LyricsWorkflowProps["onApplyToSong"];
  onPreprocessCover: CoverWorkflowProps["onPreprocess"];
  onGenerateCover: CoverWorkflowProps["onGenerate"];
}

export function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

export function validateLyricsDraft(
  mode: LyricsGenerationMode,
  lyrics: string,
): string | null {
  if (mode === "edit" && !lyrics.trim()) {
    return "Add the lyrics you want MiniMax to edit.";
  }
  if (lyrics.length > 3500) {
    return "Existing lyrics must be 3,500 characters or fewer.";
  }
  return null;
}

export function validateReference(
  sourceMode: ReferenceSourceMode,
  audioUrl: string,
  audioBase64: string,
  readingFile: boolean,
): string | null {
  if (readingFile) return "Wait for the reference file to finish loading.";
  if (sourceMode === "file") {
    return audioBase64 ? null : "Choose a reference audio file.";
  }
  return /^https?:\/\//i.test(audioUrl.trim()) ? null : "Enter a public http or https audio URL.";
}

export function validateCoverPrompt(prompt: string): string | null {
  const length = prompt.trim().length;
  if (length < 10) {
    return "Describe the target cover style in at least 10 characters.";
  }
  if (length > 300) return "The cover style must be 300 characters or fewer.";
  return null;
}

export function validateCoverLyrics(
  lyrics: string,
  required: boolean,
): string | null {
  const length = lyrics.trim().length;
  if (length === 0) {
    return required ? "Add the extracted or replacement lyrics." : null;
  }
  if (length < 10) return "Cover lyrics must be at least 10 characters.";
  if (length > 1000) return "Cover lyrics must be 1,000 characters or fewer.";
  return null;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.substring(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Could not read that audio file."));
    reader.readAsDataURL(file);
  });
}

function directSource(
  mode: ReferenceSourceMode,
  audioUrl: string,
  audioBase64: string,
): CoverDirectSource {
  return mode === "url"
    ? { type: "url", url: audioUrl.trim() }
    : { type: "base64", data: audioBase64 };
}

function durationLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

export function AdvancedWorkflows({
  onGenerateLyrics,
  onApplyLyricsToSong,
  onPreprocessCover,
  onGenerateCover,
}: AdvancedWorkflowsProps) {
  const [workflow, setWorkflow] = useState<AdvancedWorkflow>("lyrics");
  const tabsId = useId();

  return (
    <section className="advanced-workflows" aria-labelledby={`${tabsId}-title`}>
      <div className="advanced-workflows__intro">
        <div>
          <p className="eyebrow">Creative tools</p>
          <h2 id={`${tabsId}-title`}>Lyrics and covers</h2>
          <p>
            Write structured lyrics from an idea or reimagine a reference recording with every
            MiniMax cover option.
          </p>
        </div>
        <div
          className="workflow-tabs"
          role="tablist"
          aria-label="Creative workflow"
        >
          <button
            id={`${tabsId}-lyrics-tab`}
            type="button"
            role="tab"
            aria-selected={workflow === "lyrics"}
            aria-controls={`${tabsId}-lyrics-panel`}
            onClick={() => setWorkflow("lyrics")}
          >
            <PencilLine /> Lyrics
          </button>
          <button
            id={`${tabsId}-cover-tab`}
            type="button"
            role="tab"
            aria-selected={workflow === "cover"}
            aria-controls={`${tabsId}-cover-panel`}
            onClick={() => setWorkflow("cover")}
          >
            <AudioLines /> Cover
          </button>
        </div>
      </div>

      <div
        id={`${tabsId}-lyrics-panel`}
        role="tabpanel"
        aria-labelledby={`${tabsId}-lyrics-tab`}
        hidden={workflow !== "lyrics"}
      >
        <LyricsWorkflow
          onGenerate={onGenerateLyrics}
          onApplyToSong={onApplyLyricsToSong}
        />
      </div>
      <div
        id={`${tabsId}-cover-panel`}
        role="tabpanel"
        aria-labelledby={`${tabsId}-cover-tab`}
        hidden={workflow !== "cover"}
      >
        <CoverWorkflow
          onPreprocess={onPreprocessCover}
          onGenerate={onGenerateCover}
        />
      </div>
    </section>
  );
}

export function LyricsWorkflow(
  { onGenerate, onApplyToSong }: LyricsWorkflowProps,
) {
  const [mode, setMode] = useState<LyricsGenerationMode>("write_full_song");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [result, setResult] = useState<GenerateLyricsResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  const validation = validateLyricsDraft(mode, lyrics);

  async function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (busy || validation) return;
    setBusy(true);
    setCopied(false);
    setError(null);
    const input: GenerateLyricsInput = {
      mode,
      prompt: prompt.trim() || undefined,
      lyrics: mode === "edit" ? lyrics.trim() : undefined,
      title: title.trim() || undefined,
    };
    try {
      setResult(await onGenerate(input));
    } catch (caught) {
      setError(errorMessage(caught, "Could not generate lyrics."));
    } finally {
      setBusy(false);
    }
  }

  async function copyLyrics() {
    try {
      await navigator.clipboard.writeText(result!.lyrics);
      setCopied(true);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught, "Could not copy the lyrics."));
    }
  }

  return (
    <section className="workflow-panel" aria-labelledby={`${formId}-title`}>
      <header className="workflow-panel__header">
        <div className="workflow-panel__heading">
          <span className="workflow-panel__icon" aria-hidden="true">
            <WandSparkles />
          </span>
          <div>
            <h3 id={`${formId}-title`}>Lyrics studio</h3>
            <p>
              Start from a theme, or give MiniMax lyrics to rewrite, extend, or reshape.
            </p>
          </div>
        </div>
        <div className="workflow-segment" aria-label="Lyrics generation mode">
          <button
            type="button"
            aria-pressed={mode === "write_full_song"}
            onClick={() => setMode("write_full_song")}
          >
            <Sparkles /> Write a song
          </button>
          <button
            type="button"
            aria-pressed={mode === "edit"}
            onClick={() => setMode("edit")}
          >
            <PencilLine /> Edit lyrics
          </button>
        </div>
      </header>

      <form className="workflow-form" onSubmit={submit}>
        <div className="workflow-form__grid">
          <label className="workflow-field">
            <span className="workflow-field__label">
              Song title <small>optional · preserved verbatim</small>
            </span>
            <input
              value={title}
              maxLength={80}
              placeholder="Neon After Rain"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="workflow-field">
            <span className="workflow-field__label">
              Direction <span className="workflow-counter">{prompt.length}/2000</span>
            </span>
            <input
              value={prompt}
              maxLength={2000}
              placeholder={mode === "edit"
                ? "Make the chorus more hopeful…"
                : "A hopeful night-drive song…"}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          {mode === "edit" && (
            <label className="workflow-field workflow-field--wide">
              <span className="workflow-field__label">
                Existing lyrics <span className="workflow-counter">{lyrics.length}/3500</span>
              </span>
              <textarea
                value={lyrics}
                maxLength={3500}
                rows={12}
                placeholder={`[Verse]\nPaste the lyrics to edit or continue…`}
                onChange={(event) => setLyrics(event.target.value)}
              />
            </label>
          )}
        </div>

        {(error || validation) && (
          <p className="workflow-error" role="alert">
            <CircleAlert /> {error ?? validation}
          </p>
        )}
        <div className="workflow-actions">
          <button
            className="workflow-button workflow-button--primary"
            type="submit"
            disabled={busy || Boolean(validation)}
          >
            {busy ? <span className="spinner" /> : <WandSparkles />}
            {busy ? "Writing lyrics…" : mode === "edit" ? "Edit lyrics" : "Generate lyrics"}
          </button>
        </div>
      </form>

      {result && (
        <section
          className="workflow-result"
          aria-labelledby={`${formId}-result-title`}
        >
          <header className="workflow-result__header">
            <div>
              <h4 id={`${formId}-result-title`}>{result.songTitle}</h4>
              <p>Generated song title</p>
            </div>
            <span className="workflow-tag">{result.styleTags}</span>
          </header>
          <div className="workflow-result__body">
            <label className="workflow-field">
              <span className="workflow-field__label">
                Generated lyrics{" "}
                <span className="workflow-counter">
                  {result.lyrics.length} characters
                </span>
              </span>
              <textarea
                className="workflow-result__lyrics"
                aria-label="Generated lyrics"
                value={result.lyrics}
                onChange={(event) => setResult({ ...result, lyrics: event.target.value })}
              />
            </label>
            <div className="workflow-actions">
              <button
                className="workflow-button"
                type="button"
                onClick={() => void copyLyrics()}
              >
                {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy lyrics"}
              </button>
              <button
                className="workflow-button workflow-button--primary"
                type="button"
                onClick={() => onApplyToSong(result)}
              >
                <Music2 /> Use in song <ArrowRight />
              </button>
            </div>
          </div>
        </section>
      )}
    </section>
  );
}

export function CoverWorkflow(
  { onPreprocess, onGenerate }: CoverWorkflowProps,
) {
  const [workflow, setWorkflow] = useState<CoverWorkflowMode>("one_step");
  const [model, setModel] = useState<CoverModel>("music-cover-free");
  const [sourceMode, setSourceMode] = useState<ReferenceSourceMode>("url");
  const [audioUrl, setAudioUrl] = useState("");
  const [audioBase64, setAudioBase64] = useState("");
  const [fileName, setFileName] = useState("");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [audio, setAudio] = useState<AudioSettings>({
    sampleRate: 44100,
    bitrate: 256000,
    format: "mp3",
  });
  const [prepared, setPrepared] = useState<CoverPreprocessResult | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const [preprocessing, setPreprocessing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const formId = useId();

  const referenceError = validateReference(
    sourceMode,
    audioUrl,
    audioBase64,
    readingFile,
  );
  const promptError = validateCoverPrompt(prompt);
  const oneStepLyricsError = validateCoverLyrics(lyrics, false);
  const twoStepLyricsError = validateCoverLyrics(lyrics, true);
  const generationValidation = workflow === "one_step"
    ? referenceError ?? promptError ?? oneStepLyricsError
    : prepared
    ? promptError ?? twoStepLyricsError
    : referenceError;

  function clearPreparation() {
    setPrepared(null);
    if (workflow === "two_step") setLyrics("");
    setNotice(null);
  }

  function chooseSource(next: ReferenceSourceMode) {
    setSourceMode(next);
    clearPreparation();
    setError(null);
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    clearPreparation();
    setError(null);
    if (file.size > MAX_REFERENCE_BYTES) {
      setFileName("");
      setAudioBase64("");
      setError("Reference audio must be 50 MB or smaller.");
      return;
    }
    setReadingFile(true);
    setFileName(file.name);
    try {
      setAudioBase64(await readFileAsBase64(file));
    } catch (caught) {
      setFileName("");
      setAudioBase64("");
      setError(errorMessage(caught, "Could not read that audio file."));
    } finally {
      setReadingFile(false);
    }
  }

  async function preprocess(
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ) {
    event.preventDefault();
    if (preprocessing || referenceError) return;
    setPreprocessing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await onPreprocess({
        source: directSource(sourceMode, audioUrl, audioBase64),
      });
      setPrepared(result);
      setLyrics(result.formattedLyrics);
    } catch (caught) {
      setError(errorMessage(caught, "Could not prepare the reference audio."));
    } finally {
      setPreprocessing(false);
    }
  }

  async function generate(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (generating || generationValidation) return;
    setGenerating(true);
    setError(null);
    setNotice(null);
    const source: CoverGenerationSource = workflow === "two_step"
      ? { type: "feature", featureId: prepared!.coverFeatureId }
      : directSource(sourceMode, audioUrl, audioBase64);
    const input: CreateCoverGenerationInput = {
      model,
      source,
      prompt: prompt.trim(),
      lyrics: lyrics.trim() || undefined,
      title: title.trim() || undefined,
      audio,
    };
    try {
      await onGenerate(input);
      setNotice("Cover added to the generation queue.");
    } catch (caught) {
      setError(errorMessage(caught, "Could not generate the cover."));
    } finally {
      setGenerating(false);
    }
  }

  const sourcePanel = (
    <ReferenceAudioField
      id={formId}
      sourceMode={sourceMode}
      audioUrl={audioUrl}
      fileName={fileName}
      readingFile={readingFile}
      onSourceMode={chooseSource}
      onAudioUrl={(value) => {
        setAudioUrl(value);
        clearPreparation();
      }}
      onFile={chooseFile}
    />
  );

  return (
    <section className="workflow-panel" aria-labelledby={`${formId}-title`}>
      <header className="workflow-panel__header">
        <div className="workflow-panel__heading">
          <span className="workflow-panel__icon" aria-hidden="true">
            <AudioLines />
          </span>
          <div>
            <h3 id={`${formId}-title`}>Cover studio</h3>
            <p>
              Use a reference directly, or preprocess it first to revise the extracted lyrics.
            </p>
          </div>
        </div>
        <div className="workflow-segment" aria-label="Cover workflow">
          <button
            type="button"
            aria-pressed={workflow === "one_step"}
            onClick={() => setWorkflow("one_step")}
          >
            <Sparkles /> One-step
          </button>
          <button
            type="button"
            aria-pressed={workflow === "two_step"}
            onClick={() => setWorkflow("two_step")}
          >
            <PencilLine /> Two-step
          </button>
        </div>
      </header>

      {workflow === "two_step" && (
        <div className="workflow-form" aria-label="Cover workflow progress">
          <div className="workflow-stepper">
            <div
              className={`workflow-step ${prepared ? "is-complete" : "is-active"}`}
            >
              <span>{prepared ? <Check size={13} /> : "1"}</span> Reference
            </div>
            <div className={`workflow-step ${prepared ? "is-complete" : ""}`}>
              <span>{prepared ? <Check size={13} /> : "2"}</span> Prepare
            </div>
            <div className={`workflow-step ${prepared ? "is-active" : ""}`}>
              <span>3</span> Generate
            </div>
          </div>
        </div>
      )}

      {workflow === "two_step" && !prepared
        ? (
          <form className="workflow-form" onSubmit={preprocess}>
            {sourcePanel}
            <p className="workflow-callout">
              <FileAudio />{" "}
              Preprocessing is free and returns editable structured lyrics plus a feature ID that
              remains valid for 24 hours.
            </p>
            {(error || referenceError) && (
              <p className="workflow-error" role="alert">
                <CircleAlert /> {error ?? referenceError}
              </p>
            )}
            <div className="workflow-actions">
              <button
                className="workflow-button workflow-button--primary"
                type="submit"
                disabled={preprocessing || readingFile ||
                  Boolean(referenceError)}
              >
                {preprocessing ? <span className="spinner" /> : <WandSparkles />}
                {preprocessing ? "Preparing audio…" : "Prepare reference"}
              </button>
            </div>
          </form>
        )
        : (
          <form className="workflow-form" onSubmit={generate}>
            {workflow === "one_step" && sourcePanel}

            {workflow === "two_step" && prepared && (
              <>
                <dl
                  className="workflow-metadata"
                  aria-label="Preprocess metadata"
                >
                  <div>
                    <dt>Feature ID</dt>
                    <dd title={prepared.coverFeatureId}>
                      {prepared.coverFeatureId}
                    </dd>
                  </div>
                  <div>
                    <dt>Duration</dt>
                    <dd>{durationLabel(prepared.audioDuration)}</dd>
                  </div>
                  <div>
                    <dt>Trace ID</dt>
                    <dd title={prepared.traceId ?? "Not returned"}>
                      {prepared.traceId ?? "Not returned"}
                    </dd>
                  </div>
                </dl>
                <details>
                  <summary className="workflow-button">
                    Structure metadata
                  </summary>
                  <pre className="workflow-structure">{prepared.structureResult}</pre>
                </details>
              </>
            )}

            <div className="workflow-form__grid">
              <label className="workflow-field">
                <span className="workflow-field__label">
                  Local title <small>optional</small>
                </span>
                <input
                  value={title}
                  maxLength={80}
                  placeholder="Late-night lounge cover"
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <div className="workflow-field">
                <span className="workflow-field__label">Cover model</span>
                <div className="workflow-segment" aria-label="Cover model">
                  {COVER_MODELS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={model === item}
                      onClick={() => setModel(item)}
                    >
                      {item === "music-cover-free" ? "Free · 3 RPM" : "Paid"}
                    </button>
                  ))}
                </div>
              </div>
              <label className="workflow-field workflow-field--wide">
                <span className="workflow-field__label">
                  Target style <span className="workflow-counter">{prompt.length}/300</span>
                </span>
                <textarea
                  value={prompt}
                  maxLength={300}
                  rows={4}
                  placeholder="Smooth late-night jazz, brushed drums, upright bass, warm saxophone…"
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </label>
              <label className="workflow-field workflow-field--wide">
                <span className="workflow-field__label">
                  {workflow === "two_step" ? "Extracted lyrics" : "Replacement lyrics"}
                  <span className="workflow-counter">
                    {lyrics.length}/1000 · {workflow === "one_step" ? "optional" : "required"}
                  </span>
                </span>
                <textarea
                  value={lyrics}
                  maxLength={1000}
                  rows={10}
                  placeholder={workflow === "one_step"
                    ? "Leave empty to extract lyrics from the reference…"
                    : "Review and edit the extracted lyrics…"}
                  onChange={(event) => setLyrics(event.target.value)}
                />
              </label>
            </div>

            <AudioOutputFields
              audio={audio}
              disabled={generating}
              onChange={setAudio}
            />

            {(error || generationValidation) && (
              <p className="workflow-error" role="alert">
                <CircleAlert /> {error ?? generationValidation}
              </p>
            )}
            {notice && (
              <p className="workflow-success" role="status">
                <Check /> {notice}
              </p>
            )}
            <div className="workflow-actions">
              {workflow === "two_step" && prepared && (
                <button
                  className="workflow-button"
                  type="button"
                  onClick={clearPreparation}
                >
                  <Upload /> Replace reference
                </button>
              )}
              <button
                className="workflow-button workflow-button--primary"
                type="submit"
                disabled={generating || Boolean(generationValidation)}
              >
                {generating ? <span className="spinner" /> : <Sparkles />}
                {generating ? "Generating cover…" : "Generate cover"}
              </button>
            </div>
          </form>
        )}
    </section>
  );
}

function ReferenceAudioField({
  id,
  sourceMode,
  audioUrl,
  fileName,
  readingFile,
  onSourceMode,
  onAudioUrl,
  onFile,
}: {
  id: string;
  sourceMode: ReferenceSourceMode;
  audioUrl: string;
  fileName: string;
  readingFile: boolean;
  onSourceMode: (mode: ReferenceSourceMode) => void;
  onAudioUrl: (value: string) => void;
  onFile: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <section className="workflow-source" aria-labelledby={`${id}-source-title`}>
      <div className="workflow-source__topline">
        <strong id={`${id}-source-title`}>Reference audio</strong>
        <div
          className="workflow-source__tabs"
          aria-label="Reference audio source"
        >
          <button
            type="button"
            aria-pressed={sourceMode === "url"}
            onClick={() => onSourceMode("url")}
          >
            <Link2 size={15} /> URL
          </button>
          <button
            type="button"
            aria-pressed={sourceMode === "file"}
            onClick={() => onSourceMode("file")}
          >
            <Upload size={15} /> Local file
          </button>
        </div>
      </div>
      {sourceMode === "url"
        ? (
          <label className="workflow-field">
            <span className="workflow-field__label">Public audio URL</span>
            <input
              type="url"
              value={audioUrl}
              placeholder="https://example.com/reference.mp3"
              onChange={(event) => onAudioUrl(event.target.value)}
            />
          </label>
        )
        : (
          <label className="workflow-file">
            <Upload />
            <strong>
              {readingFile ? "Reading reference…" : "Choose reference audio"}
            </strong>
            <span>
              {fileName ||
                "MP3, WAV, FLAC and common audio formats · up to 50 MB"}
            </span>
            <input
              type="file"
              accept="audio/*,.flac"
              disabled={readingFile}
              onChange={onFile}
            />
          </label>
        )}
      <span className="workflow-hint">
        Reference duration must be between 6 seconds and 6 minutes.
      </span>
    </section>
  );
}

function AudioOutputFields({
  audio,
  disabled,
  onChange,
}: {
  audio: AudioSettings;
  disabled: boolean;
  onChange: (audio: AudioSettings) => void;
}) {
  return (
    <div
      className="workflow-form__grid workflow-form__grid--audio"
      aria-label="Audio output"
    >
      <label className="workflow-field workflow-select">
        <span className="workflow-field__label">Format</span>
        <select
          aria-label="Cover format"
          value={audio.format}
          disabled={disabled}
          onChange={(event) => onChange({ ...audio, format: event.target.value as AudioFormat })}
        >
          {AUDIO_FORMATS.map((format) => (
            <option key={format} value={format}>{format.toUpperCase()}</option>
          ))}
        </select>
        <ChevronDown />
      </label>
      <label className="workflow-field workflow-select">
        <span className="workflow-field__label">Sample rate</span>
        <select
          aria-label="Cover sample rate"
          value={audio.sampleRate}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...audio,
              sampleRate: Number(event.target.value) as SampleRate,
            })}
        >
          {SAMPLE_RATES.map((rate) => (
            <option key={rate} value={rate}>
              {(rate / 1000).toFixed(rate === 44100 ? 1 : 0)} kHz
            </option>
          ))}
        </select>
        <ChevronDown />
      </label>
      <label className="workflow-field workflow-select">
        <span className="workflow-field__label">Bitrate</span>
        <select
          aria-label="Cover bitrate"
          value={audio.bitrate}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...audio,
              bitrate: Number(event.target.value) as Bitrate,
            })}
        >
          {BITRATES.map((bitrate) => (
            <option key={bitrate} value={bitrate}>{bitrate / 1000} kbps</option>
          ))}
        </select>
        <ChevronDown />
      </label>
      <div className="workflow-callout">
        <FileAudio /> The generated file is copied into local storage immediately.
      </div>
    </div>
  );
}
