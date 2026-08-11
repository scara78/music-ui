import { type SyntheticEvent, useEffect, useState } from "react";
import type { Generation } from "@contracts";
import { isActiveStatus } from "@contracts";
import { Check, Download, LoaderCircle, Pencil, Trash2, X } from "lucide-react";
import {
  downloadFilename,
  formatBytes,
  formatDuration,
  generationKindLabel,
  isCoverGeneration,
} from "../lib/format";
import { Artwork } from "./Artwork";

export interface DetailsDialogProps {
  generation: Generation;
  onClose: () => void;
  onRename: (generation: Generation, title: string) => Promise<void>;
  onRemove: (generation: Generation) => void | Promise<void>;
  removing: boolean;
}

export function DetailsDialog(
  { generation, onClose, onRename, onRemove, removing }: DetailsDialogProps,
) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(generation.title);
  const [saving, setSaving] = useState(false);
  const removalBlocked = isActiveStatus(generation.status);

  useEffect(() => {
    setTitle(generation.title);
  }, [generation.title]);

  async function save(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (!title.trim() || title.trim() === generation.title) {
      setEditing(false);
      return;
    }
    setSaving(true);
    await onRename(generation, title.trim());
    setSaving(false);
    setEditing(false);
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
      >
        <button
          className="dialog-close"
          type="button"
          onClick={onClose}
          aria-label="Close details"
        >
          <X />
        </button>
        <div className="detail-hero">
          <Artwork generation={generation} />
          <div>
            {editing
              ? (
                <form className="rename-form" onSubmit={save}>
                  <input
                    aria-label="Track title"
                    value={title}
                    maxLength={80}
                    onChange={(event) => setTitle(event.target.value)}
                    autoFocus
                  />
                  <button
                    type="submit"
                    aria-label="Save title"
                    disabled={saving}
                  >
                    <Check size={17} />
                  </button>
                </form>
              )
              : (
                <div className="detail-title-row">
                  <h2 id="detail-title">{generation.title}</h2>
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    aria-label="Rename track"
                  >
                    <Pencil size={15} />
                  </button>
                </div>
              )}
            <p>{generation.model} · {generation.status}</p>
            <div className="detail-hero-actions">
              {generation.audioUrl && (
                <a
                  className="primary-link"
                  href={generation.audioUrl}
                  download={downloadFilename(generation)}
                >
                  <Download size={16} /> Download audio
                </a>
              )}
              <button
                type="button"
                className="danger-link"
                disabled={removing || removalBlocked}
                aria-label={removalBlocked
                  ? `Cannot remove ${generation.title} while ${generation.status}`
                  : undefined}
                title={removalBlocked
                  ? "Wait until generation finishes before removing this track."
                  : undefined}
                onClick={() => void onRemove(generation)}
              >
                {removing ? <LoaderCircle size={16} /> : <Trash2 size={16} />}
                {removing ? "Removing…" : removalBlocked ? "Wait to remove" : "Remove track"}
              </button>
            </div>
          </div>
        </div>
        <dl className="metadata-grid">
          <div>
            <dt>Duration</dt>
            <dd>{formatDuration(generation.durationMs)}</dd>
          </div>
          <div>
            <dt>File size</dt>
            <dd>{formatBytes(generation.sizeBytes)}</dd>
          </div>
          <div>
            <dt>Output</dt>
            <dd>
              {generation.audio.format.toUpperCase()} · {generation.audio.sampleRate / 1000} kHz ·
              {" "}
              {generation.audio.bitrate / 1000} kbps
            </dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>
              {isCoverGeneration(generation)
                ? generationKindLabel(generation)
                : generation.instrumental
                ? "Instrumental"
                : generation.lyricsOptimizer
                ? "Auto lyrics"
                : "Custom lyrics"}
            </dd>
          </div>
        </dl>
        <div className="detail-section">
          <h3>Sound description</h3>
          <p>{generation.prompt || "No style prompt supplied."}</p>
        </div>
        {!generation.instrumental && (
          <div className="detail-section">
            <h3>Lyrics</h3>
            <pre>{generation.lyrics || "Lyrics were generated by MiniMax and are not returned by this endpoint."}</pre>
          </div>
        )}
        {generation.errorMessage && (
          <div className="detail-section detail-section--error">
            <h3>Error · {generation.errorCode}</h3>
            <p>{generation.errorMessage}</p>
          </div>
        )}
        {generation.traceId && <p className="trace-id">MiniMax trace · {generation.traceId}</p>}
      </section>
    </div>
  );
}
