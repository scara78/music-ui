import { type CSSProperties, useEffect, useRef } from "react";
import type { Generation } from "@contracts";
import {
  Download,
  ListMusic,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { downloadFilename, formatPlaybackTime, generationKindLabel } from "../lib/format";
import { Artwork } from "./Artwork";

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export interface PlayerProps {
  generation: Generation;
  queue: Generation[];
  previous: Generation | null;
  next: Generation | null;
  playing: boolean;
  elapsed: number;
  duration: number;
  playbackRate: number;
  volume: number;
  muted: boolean;
  queueOpen: boolean;
  onSelect: (generation: Generation) => void;
  onPlayingChange: (playing: boolean) => void;
  onElapsedChange: (seconds: number) => void;
  onDurationChange: (seconds: number) => void;
  onPlaybackRateChange: (rate: number) => void;
  onVolumeChange: (volume: number) => void;
  onMutedChange: (muted: boolean) => void;
  onQueueToggle: () => void;
  onClose: () => void;
}

function finiteDuration(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function Player({
  generation,
  queue,
  previous,
  next,
  playing,
  elapsed,
  duration,
  playbackRate,
  volume,
  muted,
  queueOpen,
  onSelect,
  onPlayingChange,
  onElapsedChange,
  onDurationChange,
  onPlaybackRateChange,
  onVolumeChange,
  onMutedChange,
  onQueueToggle,
  onClose,
}: PlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const metadataDuration = (generation.durationMs ?? 0) / 1000;
  const knownDuration = finiteDuration(duration, metadataDuration);
  const safeElapsed = Math.min(Math.max(0, elapsed), knownDuration || elapsed);
  const progress = knownDuration > 0 ? Math.min(100, (safeElapsed / knownDuration) * 100) : 0;
  const timelineStyle = { "--range-progress": `${progress}%` } as CSSProperties;

  useEffect(() => {
    const audio = audioRef.current!;
    if (!playing || !generation.audioUrl) {
      audio.pause();
      return;
    }
    void audio.play().catch(() => onPlayingChange(false));
  }, [generation.audioUrl, generation.id, onPlayingChange, playing]);

  useEffect(() => {
    const audio = audioRef.current!;
    audio.playbackRate = playbackRate;
    audio.volume = volume;
    audio.muted = muted;
  }, [muted, playbackRate, volume]);

  function syncDuration(audio: HTMLAudioElement) {
    onDurationChange(finiteDuration(audio.duration, metadataDuration));
  }

  function seek(seconds: number) {
    audioRef.current!.currentTime = seconds;
    onElapsedChange(seconds);
  }

  function finish() {
    onElapsedChange(knownDuration);
    if (next) {
      onSelect(next);
    } else {
      onPlayingChange(false);
    }
  }

  return (
    <aside
      className="player"
      aria-label="Audio player"
      data-playing={playing || undefined}
    >
      <audio
        key={generation.id}
        ref={audioRef}
        className="player__engine"
        src={generation.audioUrl ?? undefined}
        preload="metadata"
        onPlay={() => onPlayingChange(true)}
        onPause={() => onPlayingChange(false)}
        onLoadedMetadata={(event) => syncDuration(event.currentTarget)}
        onDurationChange={(event) => syncDuration(event.currentTarget)}
        onTimeUpdate={(event) => onElapsedChange(event.currentTarget.currentTime)}
        onError={() => onPlayingChange(false)}
        onEnded={finish}
      />

      <div className="player__track">
        <Artwork generation={generation} compact />
        <div>
          <strong>{generation.title}</strong>
          <span>{generationKindLabel(generation)} · {generation.model}</span>
        </div>
      </div>

      <div className="player__controls">
        <div className="player__transport">
          <button
            type="button"
            disabled={!previous}
            onClick={() => previous && onSelect(previous)}
            aria-label="Previous track"
          >
            <SkipBack />
          </button>
          <button
            type="button"
            className="player__play"
            onClick={() => onPlayingChange(!playing)}
            aria-label={playing ? "Pause track" : "Play track"}
          >
            {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
          </button>
          <button
            type="button"
            disabled={!next}
            onClick={() => next && onSelect(next)}
            aria-label="Next track"
          >
            <SkipForward />
          </button>
        </div>
        <div className="player__timeline">
          <span>{formatPlaybackTime(safeElapsed)}</span>
          <input
            type="range"
            min="0"
            max={knownDuration || 0}
            step="0.1"
            value={safeElapsed}
            disabled={knownDuration <= 0}
            style={timelineStyle}
            onChange={(event) => seek(Number(event.target.value))}
            aria-label="Seek through track"
            aria-valuetext={`${formatPlaybackTime(safeElapsed)} of ${
              formatPlaybackTime(knownDuration)
            }`}
          />
          <span>{formatPlaybackTime(knownDuration)}</span>
        </div>
      </div>

      <div className="player__actions">
        <label className="player__speed">
          <span className="sr-only">Playback speed</span>
          <select
            aria-label="Playback speed"
            value={playbackRate}
            onChange={(event) => onPlaybackRateChange(Number(event.target.value))}
          >
            {PLAYBACK_RATES.map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
          </select>
        </label>
        <div className="player__volume">
          <button
            type="button"
            onClick={() => onMutedChange(!muted)}
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted ? <VolumeX /> : <Volume2 />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            style={{ "--range-progress": `${volume * 100}%` } as CSSProperties}
            onChange={(event) => onVolumeChange(Number(event.target.value))}
            aria-label="Volume"
          />
        </div>
        <button
          type="button"
          className={queueOpen ? "is-active" : ""}
          onClick={onQueueToggle}
          aria-label={queueOpen ? "Close queue" : "Open queue"}
          aria-expanded={queueOpen}
          aria-controls="playback-queue"
        >
          <ListMusic />
        </button>
        {generation.audioUrl && (
          <a
            href={generation.audioUrl}
            download={downloadFilename(generation)}
            aria-label="Download playing track"
          >
            <Download />
          </a>
        )}
        <button type="button" onClick={onClose} aria-label="Close player">
          <X />
        </button>
      </div>

      {queueOpen && (
        <section
          className="player-queue"
          id="playback-queue"
          aria-label="Playback queue"
        >
          <div className="player-queue__heading">
            <div>
              <span>Up next</span>
              <strong>
                {queue.length} {queue.length === 1 ? "track" : "tracks"}
              </strong>
            </div>
            <button
              type="button"
              onClick={onQueueToggle}
              aria-label="Close playback queue"
            >
              <X />
            </button>
          </div>
          {queue.length > 0
            ? (
              <ol>
                {queue.map((item) => {
                  const active = item.id === generation.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={active ? "is-active" : ""}
                        onClick={() => onSelect(item)}
                        aria-label={`Play ${item.title} from queue`}
                        aria-current={active ? "true" : undefined}
                      >
                        <Artwork generation={item} compact />
                        <span>
                          <strong>{item.title}</strong>
                          <small>
                            {generationKindLabel(item)} ·{" "}
                            {formatPlaybackTime((item.durationMs ?? 0) / 1000)}
                          </small>
                        </span>
                        {active && <i>{playing ? "Playing" : "Paused"}</i>}
                      </button>
                    </li>
                  );
                })}
              </ol>
            )
            : (
              <p className="player-queue__empty">
                No playable tracks are queued.
              </p>
            )}
        </section>
      )}
    </aside>
  );
}
