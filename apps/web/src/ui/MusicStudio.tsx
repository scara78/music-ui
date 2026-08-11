import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AppConfig,
  CoverPreprocessInput,
  CoverPreprocessResult,
  CreateCoverGenerationInput,
  CreateGenerationInput,
  GenerateLyricsInput,
  GenerateLyricsResult,
  Generation,
} from "@contracts";
import { isActiveStatus } from "@contracts";
import {
  BookOpen,
  CircleHelp,
  Disc3,
  Library,
  LoaderCircle,
  Menu,
  Moon,
  Music4,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sun,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { HttpMusicApi, type MusicApi } from "../lib/api";
import { draftFromGeneration, freshDraft } from "../lib/draft";
import { filterGenerations } from "../lib/format";
import { applyTheme, initialTheme, type Theme } from "../lib/theme";
import { AdvancedWorkflows } from "./AdvancedWorkflows";
import { Composer } from "./Composer";
import { DetailsDialog } from "./DetailsDialog";
import { DocsView } from "./DocsView";
import { GenerationCard } from "./GenerationCard";
import { Player } from "./Player";

type View = "create" | "library" | "settings" | "docs";
type CreateMode = "song" | "tools";
const defaultApi = new HttpMusicApi();
const NOTICE_TIMEOUT_MS = 5_000;

function mergeGenerations(
  preferred: Generation[],
  fallback: Generation[],
): Generation[] {
  const preferredIds = new Set(preferred.map((item) => item.id));
  return [
    ...preferred,
    ...fallback.filter((item) => !preferredIds.has(item.id)),
  ];
}

export function MusicStudio({ api = defaultApi }: { api?: MusicApi }) {
  const [view, setView] = useState<View>("create");
  const [createMode, setCreateMode] = useState<CreateMode>("song");
  const [mobileNav, setMobileNav] = useState(false);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [draft, setDraft] = useState<CreateGenerationInput>(() => freshDraft());
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | Generation["status"]>("all");
  const [detail, setDetail] = useState<Generation | null>(null);
  const [active, setActive] = useState<Generation | null>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<Generation | null>(null);
  const [theme, setTheme] = useState<Theme>(() =>
    initialTheme(
      localStorage,
      matchMedia("(prefers-color-scheme: dark)").matches,
    )
  );

  const refresh = useCallback(async (quiet = false) => {
    try {
      const response = await api.generations(0);
      setGenerations((current) => mergeGenerations(response.items, current));
      setTotal(response.total);
      setNextOffset((current) => Math.max(current, response.items.length));
      setDetail((current) =>
        current ? response.items.find((item) => item.id === current.id) ?? current : null
      );
      setActive((current) =>
        current ? response.items.find((item) => item.id === current.id) ?? current : null
      );
      if (!quiet) setError(null);
    } catch (caught) {
      if (!quiet) {
        setError(
          caught instanceof Error ? caught.message : "Could not load generations.",
        );
      }
    }
  }, [api]);

  useEffect(() => {
    let alive = true;
    Promise.all([api.config(), api.generations(0)]).then(
      ([nextConfig, list]) => {
        if (!alive) return;
        setConfig(nextConfig);
        setDraft((current) => ({ ...current, model: nextConfig.defaultModel }));
        setGenerations(list.items);
        setTotal(list.total);
        setNextOffset(list.items.length);
        setLoading(false);
      },
    ).catch((caught) => {
      if (!alive) return;
      setError(
        caught instanceof Error ? caught.message : "Could not open the studio.",
      );
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [api]);

  useEffect(() => {
    applyTheme(theme, document.documentElement, localStorage);
  }, [theme]);

  useEffect(() => {
    if (!notice) return;
    const timer = globalThis.setTimeout(
      () => setNotice(null),
      NOTICE_TIMEOUT_MS,
    );
    return () => globalThis.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!generations.some((generation) => isActiveStatus(generation.status))) {
      return;
    }
    const timer = globalThis.setInterval(() => void refresh(true), 2_500);
    return () => globalThis.clearInterval(timer);
  }, [generations, refresh]);

  const visible = useMemo(() => filterGenerations(generations, query, status), [
    generations,
    query,
    status,
  ]);
  const playable = useMemo(
    () =>
      generations.filter((item) =>
        item.status === "completed" && item.audioUrl &&
        item.audio.format !== "pcm"
      ),
    [generations],
  );
  const activeIndex = active ? playable.findIndex((item) => item.id === active.id) : -1;
  const previous = activeIndex > 0 ? playable[activeIndex - 1]! : null;
  const next = activeIndex >= 0 && activeIndex < playable.length - 1
    ? playable[activeIndex + 1]!
    : null;
  const progress = duration > 0 ? (elapsed / duration) * 100 : 0;

  async function create(input: CreateGenerationInput) {
    setSubmitting(true);
    setError(null);
    try {
      const generation = await api.create(input);
      setGenerations((current) => [generation, ...current]);
      setTotal((current) => current + 1);
      setNotice("Track added to the generation queue.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not start generation.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function generateLyrics(input: GenerateLyricsInput) {
    return api.generateLyrics(input);
  }

  function preprocessCover(
    input: CoverPreprocessInput,
  ): Promise<CoverPreprocessResult> {
    return api.preprocessCover(input);
  }

  async function createCover(input: CreateCoverGenerationInput) {
    const generation = await api.create(input);
    setGenerations((current) => [generation, ...current]);
    setTotal((current) => current + 1);
  }

  function applyLyrics(result: GenerateLyricsResult) {
    setDraft((current) => ({
      ...current,
      title: result.songTitle,
      prompt: result.styleTags,
      lyrics: result.lyrics,
      lyricsOptimizer: false,
      instrumental: false,
    }));
    setCreateMode("song");
    setNotice(`Loaded “${result.songTitle}” into the song composer.`);
    globalThis.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function retry(generation: Generation) {
    try {
      const retried = await api.retry(generation.id);
      setGenerations((current) => [retried, ...current]);
      setTotal((current) => current + 1);
      setNotice("A fresh retry was queued with the same settings.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not retry generation.",
      );
    }
  }

  async function rename(generation: Generation, title: string) {
    const updated = await api.rename(generation.id, title);
    setGenerations((current) => current.map((item) => item.id === updated.id ? updated : item));
    setDetail(updated);
    setActive((current) => current?.id === updated.id ? updated : current);
  }

  async function remove(generation: Generation) {
    setRemovingId(generation.id);
    setError(null);
    try {
      await api.remove(generation.id);
      setGenerations((current) => current.filter((item) => item.id !== generation.id));
      setTotal((current) => Math.max(0, current - 1));
      setNextOffset((current) => Math.max(0, current - 1));
      setDetail((current) => current?.id === generation.id ? null : current);
      setActive((current) => current?.id === generation.id ? null : current);
      if (active?.id === generation.id) {
        setPlaying(false);
        setElapsed(0);
        setDuration(0);
        setQueueOpen(false);
      }
      setNotice(`Removed “${generation.title}”.`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not remove the track.",
      );
    } finally {
      setRemovingId(null);
      setPendingRemoval(null);
    }
  }

  async function loadMore() {
    setLoadingMore(true);
    setError(null);
    try {
      const response = await api.generations(nextOffset);
      setGenerations((current) => mergeGenerations(current, response.items));
      setTotal(response.total);
      setNextOffset((current) => current + response.items.length);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load more generations.",
      );
    } finally {
      setLoadingMore(false);
    }
  }

  function useSettings(generation: Generation) {
    setDraft(draftFromGeneration(generation));
    setView("create");
    setCreateMode("song");
    setMobileNav(false);
    setNotice(`Loaded settings from “${generation.title}”.`);
    globalThis.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startTrack(generation: Generation) {
    setActive(generation);
    setPlaying(true);
    setElapsed(0);
    setDuration((generation.durationMs ?? 0) / 1000);
    setQueueOpen(false);
  }

  function toggleTrack(generation: Generation) {
    if (active?.id === generation.id) {
      setPlaying((current) => !current);
      return;
    }
    startTrack(generation);
  }

  function closePlayer() {
    setPlaying(false);
    setActive(null);
    setElapsed(0);
    setDuration(0);
    setQueueOpen(false);
  }

  function requestRemoval(generation: Generation) {
    setPendingRemoval(generation);
  }

  function changeVolume(nextVolume: number) {
    setVolume(nextVolume);
    if (nextVolume > 0) setMuted(false);
  }

  function navigate(nextView: View) {
    setView(nextView);
    setMobileNav(false);
  }

  if (loading) {
    return (
      <div className="boot-screen">
        <span className="spinner" /> Opening your studio…
      </div>
    );
  }

  return (
    <div className={`app-shell ${active ? "has-player" : ""}`}>
      <aside className={`sidebar ${mobileNav ? "is-open" : ""}`}>
        <div className="brand">
          <span>
            <Disc3 />
          </span>
          <div>
            <strong>CADENCE</strong>
            <small>MiniMax Music 3</small>
          </div>
        </div>
        <button
          className="mobile-close"
          type="button"
          onClick={() => setMobileNav(false)}
          aria-label="Close navigation"
        >
          <X />
        </button>
        <nav aria-label="Main navigation">
          <button
            type="button"
            className={view === "create" ? "is-active" : ""}
            onClick={() => navigate("create")}
          >
            <Plus /> Create
          </button>
          <button
            type="button"
            className={view === "library" ? "is-active" : ""}
            onClick={() => navigate("library")}
          >
            <Library /> Library <span>{total}</span>
          </button>
          <button
            type="button"
            className={view === "settings" ? "is-active" : ""}
            onClick={() => navigate("settings")}
          >
            <Settings /> Settings
          </button>
          <button
            type="button"
            className={view === "docs" ? "is-active" : ""}
            onClick={() => navigate("docs")}
          >
            <BookOpen /> Docs
          </button>
        </nav>
        <div className="sidebar-card">
          <span
            className={`connection-dot ${config?.apiKeyConfigured ? "is-ready" : ""}`}
          />
          <div>
            <strong>
              {config?.apiKeyConfigured ? "MiniMax connected" : "API key needed"}
            </strong>
            <small>
              {config?.defaultModel ?? "music-3.0-free"} · {config?.freeRateLimitRpm ?? 3} RPM
            </small>
          </div>
        </div>
        <button
          className="theme-button"
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun /> : <Moon />} {theme === "dark" ? "Light theme" : "Dark theme"}
        </button>
      </aside>

      {mobileNav && (
        <button
          type="button"
          className="mobile-scrim"
          onClick={() => setMobileNav(false)}
          aria-label="Close navigation overlay"
        />
      )}

      <main>
        <header className="topbar">
          <button
            className="menu-button"
            type="button"
            onClick={() => setMobileNav(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </button>
          <div>
            <strong>
              {view === "create"
                ? "Create"
                : view === "library"
                ? "Your library"
                : view === "settings"
                ? "Studio settings"
                : "Docs"}
            </strong>
            <span>Private workspace</span>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              aria-label="Help"
              onClick={() => navigate("docs")}
            >
              <CircleHelp />
            </button>
            <span className="avatar">YU</span>
          </div>
        </header>

        {!config?.apiKeyConfigured && (
          <div className="key-banner">
            <strong>Connect MiniMax to generate.</strong>
            <span>
              Add <code>MINIMAX_API_KEY</code> to <code>.env</code>, then restart the stack.
            </span>
          </div>
        )}
        {error && (
          <div className="toast toast--error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
            >
              <X />
            </button>
          </div>
        )}
        {notice && (
          <div className="toast" role="status">
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Dismiss notice"
            >
              <X />
            </button>
          </div>
        )}

        {view === "create" && (
          <section className="create-workspace" aria-label="Creation workspace">
            <div className="create-workspace__bar">
              <div
                className="create-workspace__switch"
                aria-label="Creation type"
              >
                <button
                  type="button"
                  aria-pressed={createMode === "song"}
                  onClick={() => setCreateMode("song")}
                >
                  <Music4 /> Song
                </button>
                <button
                  type="button"
                  aria-pressed={createMode === "tools"}
                  onClick={() => setCreateMode("tools")}
                >
                  <WandSparkles /> Lyrics & covers
                </button>
              </div>
            </div>

            {createMode === "song"
              ? (
                <div className="create-layout">
                  <Composer
                    draft={draft}
                    busy={submitting}
                    onChange={setDraft}
                    onSubmit={create}
                  />
                  <section className="results-pane">
                    <div className="section-heading">
                      <div>
                        <p className="eyebrow">Your output</p>
                        <h2>Recent generations</h2>
                      </div>
                      <button
                        type="button"
                        className="icon-text-button"
                        onClick={() => void refresh()}
                      >
                        <RefreshCw /> Refresh
                      </button>
                    </div>
                    <GenerationList
                      generations={generations.slice(0, 12)}
                      active={active}
                      playing={playing}
                      progress={progress}
                      removingId={removingId}
                      onPlay={toggleTrack}
                      onDetails={setDetail}
                      onUseSettings={useSettings}
                      onRetry={retry}
                      onRemove={requestRemoval}
                      emptyTitle="Your first track starts here"
                      emptyCopy="Describe a sound on the left. Every request and output will be saved in this workspace."
                    />
                  </section>
                </div>
              )
              : (
                <div className="create-workspace__tools">
                  <AdvancedWorkflows
                    onGenerateLyrics={generateLyrics}
                    onApplyLyricsToSong={applyLyrics}
                    onPreprocessCover={preprocessCover}
                    onGenerateCover={createCover}
                  />
                </div>
              )}
          </section>
        )}

        {view === "library" && (
          <section className="library-view">
            <div className="library-hero">
              <div>
                <p className="eyebrow">Your collection</p>
                <h1>Library</h1>
                <p>Search loaded prompts, lyrics and local track titles.</p>
              </div>
              <button
                className="create-shortcut"
                type="button"
                onClick={() => {
                  setCreateMode("song");
                  navigate("create");
                }}
              >
                <Plus /> New track
              </button>
            </div>
            <div className="library-toolbar">
              <label className="search-box">
                <Search />
                <input
                  aria-label="Search library"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search title, prompt or lyrics"
                />
              </label>
              <label className="status-filter">
                <span className="sr-only">Filter by status</span>
                <select
                  aria-label="Filter by status"
                  value={status}
                  onChange={(event) => setStatus(event.target.value as typeof status)}
                >
                  <option value="all">All status</option>
                  <option value="completed">Ready</option>
                  <option value="queued">Queued</option>
                  <option value="generating">Generating</option>
                  <option value="failed">Failed</option>
                </select>
              </label>
              <button
                type="button"
                className="icon-text-button"
                onClick={() => void refresh()}
              >
                <RefreshCw /> Refresh
              </button>
            </div>
            <p className="result-count">
              Showing {visible.length} of {generations.length} loaded tracks · {total} total
            </p>
            <GenerationList
              generations={visible}
              active={active}
              playing={playing}
              progress={progress}
              removingId={removingId}
              onPlay={toggleTrack}
              onDetails={setDetail}
              onUseSettings={useSettings}
              onRetry={retry}
              onRemove={requestRemoval}
              emptyTitle="No loaded tracks match"
              emptyCopy={nextOffset < total
                ? "Load more to search the rest of your history."
                : "Try a different search or generation status."}
            />
            {nextOffset < total && (
              <div className="library-pagination">
                <button
                  type="button"
                  className="icon-text-button"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                >
                  {loadingMore ? "Loading more…" : "Load more"}
                </button>
              </div>
            )}
          </section>
        )}

        {view === "settings" && <SettingsView config={config} theme={theme} onTheme={setTheme} />}
        {view === "docs" && <DocsView />}
      </main>

      <nav
        className="mobile-tabs"
        aria-label="Mobile navigation"
      >
        <button
          type="button"
          className={view === "create" ? "is-active" : ""}
          onClick={() => navigate("create")}
        >
          <Music4 />Create
        </button>
        <button
          type="button"
          className={view === "library" ? "is-active" : ""}
          onClick={() => navigate("library")}
        >
          <Library />Library
        </button>
        <button
          type="button"
          className={view === "settings" ? "is-active" : ""}
          onClick={() => navigate("settings")}
        >
          <Settings />Settings
        </button>
        <button
          type="button"
          className={view === "docs" ? "is-active" : ""}
          onClick={() => navigate("docs")}
        >
          <BookOpen />Docs
        </button>
      </nav>

      {detail && (
        <DetailsDialog
          generation={detail}
          onClose={() => setDetail(null)}
          onRename={rename}
          onRemove={requestRemoval}
          removing={removingId === detail.id}
        />
      )}
      {active && (
        <Player
          generation={active}
          queue={playable}
          previous={previous}
          next={next}
          playing={playing}
          elapsed={elapsed}
          duration={duration}
          playbackRate={playbackRate}
          volume={volume}
          muted={muted}
          queueOpen={queueOpen}
          onSelect={startTrack}
          onPlayingChange={setPlaying}
          onElapsedChange={setElapsed}
          onDurationChange={setDuration}
          onPlaybackRateChange={setPlaybackRate}
          onVolumeChange={changeVolume}
          onMutedChange={setMuted}
          onQueueToggle={() => setQueueOpen((current) => !current)}
          onClose={closePlayer}
        />
      )}
      {pendingRemoval && (
        <RemoveTrackDialog
          generation={pendingRemoval}
          removing={removingId === pendingRemoval.id}
          onCancel={() => setPendingRemoval(null)}
          onConfirm={() => void remove(pendingRemoval)}
        />
      )}
    </div>
  );
}

function RemoveTrackDialog(
  {
    generation,
    removing,
    onCancel,
    onConfirm,
  }: {
    generation: Generation;
    removing: boolean;
    onCancel: () => void;
    onConfirm: () => void;
  },
) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !removing) onCancel();
    }
    globalThis.addEventListener("keydown", handleKeyDown);
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, removing]);

  return (
    <div className="dialog-backdrop remove-dialog-backdrop">
      <section
        className="remove-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-dialog-title"
        aria-describedby="remove-dialog-copy"
      >
        <span className="remove-dialog__icon">
          <Trash2 />
        </span>
        <div>
          <p className="eyebrow">Permanent action</p>
          <h2 id="remove-dialog-title">Remove “{generation.title}”?</h2>
          <p id="remove-dialog-copy">
            This deletes the saved track and its audio. This action cannot be undone.
          </p>
        </div>
        <div className="remove-dialog__actions">
          <button
            type="button"
            onClick={onCancel}
            disabled={removing}
            autoFocus
          >
            Cancel
          </button>
          <button
            type="button"
            className="is-danger"
            onClick={onConfirm}
            disabled={removing}
          >
            {removing ? <LoaderCircle /> : <Trash2 />}
            {removing ? "Removing…" : "Remove track"}
          </button>
        </div>
      </section>
    </div>
  );
}

interface GenerationListProps {
  generations: Generation[];
  active: Generation | null;
  playing: boolean;
  progress: number;
  removingId: string | null;
  onPlay: (generation: Generation) => void;
  onDetails: (generation: Generation) => void;
  onUseSettings: (generation: Generation) => void;
  onRetry: (generation: Generation) => void | Promise<void>;
  onRemove: (generation: Generation) => void | Promise<void>;
  emptyTitle: string;
  emptyCopy: string;
}

export function GenerationList(
  {
    generations,
    active,
    playing,
    progress,
    removingId,
    onPlay,
    onDetails,
    onUseSettings,
    onRetry,
    onRemove,
    emptyTitle,
    emptyCopy,
  }: GenerationListProps,
) {
  if (generations.length === 0) {
    return (
      <div className="empty-state">
        <span>
          <Music4 />
        </span>
        <h3>{emptyTitle}</h3>
        <p>{emptyCopy}</p>
      </div>
    );
  }
  return (
    <div className="generation-list">
      {generations.map((generation) => (
        <GenerationCard
          key={generation.id}
          generation={generation}
          active={active?.id === generation.id}
          playing={playing && active?.id === generation.id}
          progress={active?.id === generation.id ? progress : 0}
          removing={removingId === generation.id}
          onPlay={onPlay}
          onDetails={onDetails}
          onUseSettings={onUseSettings}
          onRetry={onRetry}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}

function SettingsView(
  { config, theme, onTheme }: {
    config: AppConfig | null;
    theme: Theme;
    onTheme: (theme: Theme) => void;
  },
) {
  return (
    <section className="settings-view">
      <div>
        <p className="eyebrow">Local-first</p>
        <h1>Studio settings</h1>
        <p className="settings-intro">
          Cadence keeps generated audio and history in your Docker volume. Credentials remain on the
          API server.
        </p>
      </div>
      <div className="settings-grid">
        <article>
          <span className="settings-icon">
            <Disc3 />
          </span>
          <div>
            <h2>MiniMax connection</h2>
            <p>
              {config?.apiKeyConfigured ? "Ready to generate" : "Missing API key"}
            </p>
            <dl>
              <div>
                <dt>Default model</dt>
                <dd>{config?.defaultModel}</dd>
              </div>
              <div>
                <dt>Free limit</dt>
                <dd>{config?.freeRateLimitRpm} requests/min</dd>
              </div>
            </dl>
          </div>
        </article>
        <article>
          <span className="settings-icon">
            <Library />
          </span>
          <div>
            <h2>Data separation</h2>
            <p>
              Every query and audio path is tenant-scoped today, ready for authentication later.
            </p>
            <dl>
              <div>
                <dt>Metadata</dt>
                <dd>SQLite</dd>
              </div>
              <div>
                <dt>Media</dt>
                <dd>Local volume</dd>
              </div>
            </dl>
          </div>
        </article>
        <article>
          <span className="settings-icon">
            {theme === "dark" ? <Moon /> : <Sun />}
          </span>
          <div>
            <h2>Appearance</h2>
            <p>Choose the palette that suits your room.</p>
            <div className="theme-segment">
              <button
                type="button"
                className={theme === "light" ? "is-active" : ""}
                onClick={() => onTheme("light")}
              >
                <Sun /> Light
              </button>
              <button
                type="button"
                className={theme === "dark" ? "is-active" : ""}
                onClick={() => onTheme("dark")}
              >
                <Moon /> Dark
              </button>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

export default MusicStudio;
