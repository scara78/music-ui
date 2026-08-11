import { useState } from "react";
import type { Generation } from "@contracts";
import { isActiveStatus } from "@contracts";
import {
  CircleAlert,
  CopyPlus,
  Download,
  Eye,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  downloadFilename,
  formatDate,
  formatDuration,
  generationKindLabel,
  isCoverGeneration,
} from "../lib/format";
import { Artwork } from "./Artwork";

export interface GenerationCardProps {
  generation: Generation;
  active: boolean;
  playing: boolean;
  progress: number;
  removing: boolean;
  onPlay: (generation: Generation) => void;
  onDetails: (generation: Generation) => void;
  onUseSettings: (generation: Generation) => void;
  onRetry: (generation: Generation) => void | Promise<void>;
  onRemove: (generation: Generation) => void | Promise<void>;
}

export function GenerationCard(
  {
    generation,
    active,
    playing,
    progress,
    removing,
    onPlay,
    onDetails,
    onUseSettings,
    onRetry,
    onRemove,
  }: GenerationCardProps,
) {
  const ready = generation.status === "completed" && generation.audioUrl;
  const playable = ready && generation.audio.format !== "pcm";
  const removalBlocked = isActiveStatus(generation.status);
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    const confirmed = globalThis.confirm(
      `Retry “${generation.title}” with the same settings? This starts a new MiniMax generation.`,
    );
    if (!confirmed) return;
    setRetrying(true);
    try {
      await onRetry(generation);
    } finally {
      setRetrying(false);
    }
  }

  const progressPercent = Math.round(Math.min(100, Math.max(0, progress)));
  const playbackLabel = active ? (playing ? "Pause" : "Resume") : "Play";

  return (
    <article
      className={`generation-card ${active ? "is-active" : ""} ${
        active && playing ? "is-playing" : ""
      }`}
    >
      <div className="generation-card__art">
        <Artwork generation={generation} />
        {playable && (
          <button
            type="button"
            className="art-play"
            onClick={() => onPlay(generation)}
            aria-label={`${playbackLabel} ${generation.title}`}
            aria-pressed={active && playing}
          >
            {active && playing
              ? <Pause size={19} fill="currentColor" />
              : <Play size={19} fill="currentColor" />}
          </button>
        )}
        {active && (
          <span
            className="art-progress"
            role="progressbar"
            aria-label={`${generation.title} playback progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}
          >
            <i style={{ width: `${progressPercent}%` }} />
          </span>
        )}
        <span className="duration-badge">
          {formatDuration(generation.durationMs)}
        </span>
      </div>
      <div className="generation-card__body">
        <div className="card-title-row">
          <div>
            <h3>{generation.title}</h3>
            <p>
              {generation.model} · {generationKindLabel(generation)} ·{" "}
              {formatDate(generation.createdAt)}
            </p>
          </div>
          <span className={`status-pill status-pill--${generation.status}`}>
            {(generation.status === "queued" ||
              generation.status === "generating") && <LoaderCircle size={12} />}
            {generation.status === "failed" && <CircleAlert size={12} />}
            {generation.status}
          </span>
        </div>
        <p className="prompt-excerpt">
          {generation.prompt || "Custom lyric-led song"}
        </p>
        {generation.status === "failed" && <p className="failure-copy">{generation.errorMessage}
        </p>}
        <div className="card-actions">
          {!isCoverGeneration(generation) && (
            <button
              type="button"
              onClick={() => onUseSettings(generation)}
            >
              <CopyPlus size={15} /> Use settings
            </button>
          )}
          <button type="button" onClick={() => onDetails(generation)}>
            <Eye size={15} /> Details
          </button>
          {generation.status === "failed" && (
            <button
              type="button"
              disabled={retrying}
              onClick={() => void retry()}
            >
              {retrying ? <LoaderCircle size={15} /> : <RotateCcw size={15} />}
              {retrying ? "Retrying…" : "Retry"}
            </button>
          )}
          {ready && (
            <a
              href={generation.audioUrl!}
              download={downloadFilename(generation)}
            >
              <Download size={15} /> Download
            </a>
          )}
          <button
            type="button"
            className="danger-action"
            disabled={removing || removalBlocked}
            aria-label={removalBlocked
              ? `Cannot remove ${generation.title} while ${generation.status}`
              : undefined}
            title={removalBlocked
              ? "Wait until generation finishes before removing this track."
              : undefined}
            onClick={() => void onRemove(generation)}
          >
            {removing ? <LoaderCircle size={15} /> : <Trash2 size={15} />}
            {removing ? "Removing…" : removalBlocked ? "Wait to remove" : "Remove"}
          </button>
        </div>
      </div>
    </article>
  );
}
