import { useState } from "react";
import type { CreateGenerationInput } from "@contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { freshDraft } from "../src/lib/draft";
import { Artwork } from "../src/ui/Artwork";
import { Composer } from "../src/ui/Composer";
import { DetailsDialog } from "../src/ui/DetailsDialog";
import { GenerationCard } from "../src/ui/GenerationCard";
import { GenerationList } from "../src/ui/MusicStudio";
import { Player, type PlayerProps } from "../src/ui/Player";
import { generation } from "./fixtures";

function ComposerHarness({
  initial = freshDraft(),
  busy = false,
  onSubmit = vi.fn(),
}: {
  initial?: CreateGenerationInput;
  busy?: boolean;
  onSubmit?: (draft: CreateGenerationInput) => void;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <Composer
      draft={draft}
      busy={busy}
      onChange={setDraft}
      onSubmit={onSubmit}
    />
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

describe("Artwork", () => {
  it("renders deterministic full and compact artwork", () => {
    const { container, rerender } = render(
      <Artwork generation={generation({ id: "AB" })} />,
    );
    expect(container.firstChild).toHaveClass("artwork");
    expect(container.firstChild).not.toHaveClass("artwork--compact");
    expect(container.querySelectorAll("i")).toHaveLength(9);
    expect(
      (container.firstChild as HTMLElement).style.getPropertyValue("--art-hue"),
    ).toBe("131");

    rerender(<Artwork generation={generation()} compact />);
    expect(container.firstChild).toHaveClass("artwork--compact");
  });
});

describe("Composer", () => {
  it("validates and submits quick prompts, cycles ideas, and handles instrumental mode", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { container } = render(<ComposerHarness onSubmit={onSubmit} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Describe the song");
    fireEvent.submit(container.querySelector("form")!);
    expect(onSubmit).not.toHaveBeenCalled();

    const prompt = screen.getByPlaceholderText(/Genre, mood/);
    await user.type(prompt, "glassy synth pop");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create track" }));
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ prompt: "glassy synth pop" }),
    );

    const inspire = screen.getByRole("button", {
      name: "Try another prompt idea",
    });
    await user.click(inspire);
    expect(prompt).toHaveValue(
      "Warm tape-saturated jazz-hop for a rainy late-night train",
    );
    await user.click(inspire);
    expect(prompt).toHaveValue(
      "Cinematic post-rock instrumental building from whispers to thunder",
    );
    await user.click(inspire);
    expect(prompt).toHaveValue(
      "Nocturnal synth-pop with glassy arpeggios and a soaring chorus",
    );

    const instrumental = screen.getByRole("checkbox", { name: /Instrumental/ });
    await user.click(instrumental);
    expect(instrumental).toBeChecked();
    await user.click(instrumental);
    expect(instrumental).not.toBeChecked();
    await user.click(instrumental);
    await user.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.queryByText("Lyrics", { selector: ".field__label" })).not
      .toBeInTheDocument();
    await user.click(instrumental);
    expect(screen.getByLabelText("Custom lyrics")).toBeInTheDocument();
  });

  it("supports custom titles, automatic and handwritten lyrics, and every output control", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <ComposerHarness
        initial={{ ...freshDraft(), prompt: "dreamy", title: "Old" }}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Custom" }));
    const title = screen.getByPlaceholderText("Midnight on Avala");
    expect(title).toHaveValue("Old");
    await user.clear(title);
    await user.type(title, "New name");
    await user.clear(title);
    expect(title).toHaveValue("");
    await user.type(title, "Final name");

    expect(screen.getByText(/MiniMax will write lyrics/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Write" }));
    const lyrics = screen.getByLabelText("Custom lyrics");
    await user.type(lyrics, "hello");
    expect(screen.getByText("5/3500")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Auto/ }));
    expect(screen.queryByLabelText("Custom lyrics")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Write" }));

    await user.click(screen.getByText("Advanced output"));
    await user.selectOptions(screen.getByLabelText("Model"), "music-3.0");
    await user.selectOptions(screen.getByLabelText("Format"), "wav");
    await user.selectOptions(screen.getByLabelText("Sample rate"), "16000");
    await user.selectOptions(screen.getByLabelText("Bitrate"), "32000");
    expect(screen.getByRole("option", { name: "music-3.0 · paid" }))
      .toBeInTheDocument();
    expect(screen.getByRole("option", { name: "music-3.0-free · 3 RPM" }))
      .toBeInTheDocument();
    expect(screen.getByRole("option", { name: "44.1 kHz" }))
      .toBeInTheDocument();
    expect(screen.getByRole("option", { name: "16 kHz" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Custom lyrics"), "lyrics");
    await user.click(screen.getByRole("button", { name: "Create track" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      title: "Final name",
      model: "music-3.0",
      lyricsOptimizer: false,
      audio: { format: "wav", sampleRate: 16000, bitrate: 32000 },
    }));

    await user.click(screen.getByRole("button", { name: "Quick" }));
    await user.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByText(/MiniMax will write lyrics/)).toBeInTheDocument();
  });

  it("cycles structured lyric ideas only while lyrics are editable without changing modes", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <ComposerHarness
        initial={{
          ...freshDraft("music-3.0"),
          prompt: "Keep this sound",
          title: "Keep title",
        }}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.queryByRole("button", { name: "Try another lyric idea" }))
      .not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.queryByRole("button", { name: "Try another lyric idea" }))
      .not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Write" }));

    const inspire = screen.getByRole("button", {
      name: "Try another lyric idea",
    });
    const lyrics = screen.getByLabelText("Custom lyrics");
    const ideas: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      await user.click(inspire);
      const idea = (lyrics as HTMLTextAreaElement).value;
      ideas.push(idea);
      expect(idea.length).toBeLessThanOrEqual(3500);
      expect(idea).toMatch(/\[Verse\]/);
      expect(idea).toMatch(/\[Chorus\]/);
      expect(screen.getByText(`${idea.length}/3500`)).toBeInTheDocument();
    }
    expect(new Set(ideas).size).toBe(3);
    expect(ideas[0]).toContain("[Pre Chorus]");
    expect(ideas[1]).toContain("[Post Chorus]");
    expect(ideas[2]).toContain("[Build Up]");
    expect(ideas[2]).toContain("[Hook]");

    await user.click(inspire);
    expect(lyrics).toHaveValue(ideas[0]);
    expect(screen.getByRole("button", { name: "Write" })).toHaveClass(
      "is-active",
    );
    expect(screen.getByRole("checkbox", { name: /Instrumental/ })).not
      .toBeChecked();
    await user.click(screen.getByRole("button", { name: "Create track" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      title: "Keep title",
      model: "music-3.0",
      prompt: "Keep this sound",
      lyrics: ideas[0],
      lyricsOptimizer: false,
      instrumental: false,
    }));

    await user.click(screen.getByRole("button", { name: /Auto/ }));
    expect(screen.queryByRole("button", { name: "Try another lyric idea" }))
      .not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Write" }));
    expect(screen.getByRole("button", { name: "Try another lyric idea" }))
      .toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /Instrumental/ }));
    expect(screen.queryByRole("button", { name: "Try another lyric idea" }))
      .not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /Instrumental/ }));
    expect(screen.getByRole("button", { name: "Try another lyric idea" }))
      .toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Quick" }));
    expect(screen.queryByRole("button", { name: "Try another lyric idea" }))
      .not.toBeInTheDocument();
  });

  it("blocks a valid draft while busy", () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <ComposerHarness
        initial={{ ...freshDraft(), prompt: "valid" }}
        busy
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByRole("button", { name: /Adding to queue/ }))
      .toBeDisabled();
    fireEvent.submit(container.querySelector("form")!);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("initializes custom mode with handwritten lyrics", async () => {
    const user = userEvent.setup();
    render(
      <ComposerHarness
        initial={{
          ...freshDraft(),
          prompt: "style",
          lyricsOptimizer: false,
          lyrics: "existing",
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByLabelText("Custom lyrics")).toHaveValue("existing");
  });
});

describe("GenerationCard and GenerationList", () => {
  it("renders and operates a ready active generation", async () => {
    const user = userEvent.setup();
    const item = generation();
    const onPlay = vi.fn();
    const onDetails = vi.fn();
    const onUseSettings = vi.fn();
    const onRemove = vi.fn();
    const { container } = render(
      <GenerationCard
        generation={item}
        active
        playing
        progress={42}
        removing={false}
        onPlay={onPlay}
        onDetails={onDetails}
        onUseSettings={onUseSettings}
        onRetry={vi.fn()}
        onRemove={onRemove}
      />,
    );
    expect(container.querySelector("article")).toHaveClass(
      "is-active",
      "is-playing",
    );
    expect(screen.getByRole("progressbar", { name: /Midnight Signal/ }))
      .toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByText("2:05")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download/ })).toHaveAttribute(
      "download",
      "Midnight Signal.mp3",
    );
    await user.click(
      screen.getByRole("button", { name: "Pause Midnight Signal" }),
    );
    await user.click(screen.getByRole("button", { name: /Use settings/ }));
    await user.click(screen.getByRole("button", { name: /Details/ }));
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(onPlay).toHaveBeenCalledWith(item);
    expect(onUseSettings).toHaveBeenCalledWith(item);
    expect(onDetails).toHaveBeenCalledWith(item);
    expect(onRemove).toHaveBeenCalledWith(item);
  });

  it.each(
    [
      ["queued", "Custom lyric-led song"],
      ["generating", "Custom lyric-led song"],
    ] as const,
  )("renders %s progress", (status, fallback) => {
    const { container } = render(
      <GenerationCard
        generation={generation({
          status,
          prompt: "",
          durationMs: null,
          audioUrl: null,
        })}
        active={false}
        playing={false}
        progress={0}
        removing={false}
        onPlay={vi.fn()}
        onDetails={vi.fn()}
        onUseSettings={vi.fn()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(container.querySelector("article")).not.toHaveClass("is-playing");
    expect(screen.getByText(status)).toBeInTheDocument();
    expect(screen.getByText(fallback)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Play/ })).not
      .toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: `Cannot remove Midnight Signal while ${status}`,
      }),
    ).toBeDisabled();
  });

  it("confirms retries and prevents duplicate requests while one is pending", async () => {
    const user = userEvent.setup();
    const item = generation({
      status: "failed",
      audioUrl: null,
      errorMessage: "Rate limited",
      durationMs: null,
    });
    const retryResult = deferred<void>();
    const onRetry = vi.fn().mockReturnValue(retryResult.promise);
    const confirm = vi.spyOn(globalThis, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    render(
      <GenerationCard
        generation={item}
        active={false}
        playing={false}
        progress={0}
        removing={false}
        onPlay={vi.fn()}
        onDetails={vi.fn()}
        onUseSettings={vi.fn()}
        onRetry={onRetry}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText("Rate limited")).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Retry" });
    await user.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
    expect(retry).toBeEnabled();

    await user.dblClick(retry);
    expect(confirm).toHaveBeenLastCalledWith(
      "Retry “Midnight Signal” with the same settings? This starts a new MiniMax generation.",
    );
    expect(onRetry).toHaveBeenCalledWith(item);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Retrying…" })).toBeDisabled();

    retryResult.resolve();
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled());
  });

  it("does not treat completed metadata without audio as playable", () => {
    render(
      <GenerationCard
        generation={generation({ audioUrl: null, instrumental: true })}
        active={false}
        playing={false}
        progress={0}
        removing={false}
        onPlay={vi.fn()}
        onDetails={vi.fn()}
        onUseSettings={vi.fn()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText(/Instrumental/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Play/ })).not
      .toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Download/ })).not
      .toBeInTheDocument();
  });

  it("offers completed raw PCM as a download without a browser play control", () => {
    render(
      <GenerationCard
        generation={generation({
          audio: { sampleRate: 44100, bitrate: 256000, format: "pcm" },
        })}
        active={false}
        playing={false}
        progress={0}
        removing={false}
        onPlay={vi.fn()}
        onDetails={vi.fn()}
        onUseSettings={vi.fn()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /^Play/ })).not
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download/ })).toHaveAttribute(
      "download",
      "Midnight Signal.pcm",
    );
  });

  it("renders empty and populated generation lists", () => {
    const props = {
      active: null,
      playing: false,
      progress: 0,
      removingId: null,
      onPlay: vi.fn(),
      onDetails: vi.fn(),
      onUseSettings: vi.fn(),
      onRetry: vi.fn(),
      onRemove: vi.fn(),
      emptyTitle: "Nothing yet",
      emptyCopy: "Make something.",
    };
    const { rerender } = render(<GenerationList generations={[]} {...props} />);
    expect(screen.getByText("Nothing yet")).toBeInTheDocument();
    rerender(<GenerationList generations={[generation()]} {...props} />);
    expect(screen.getByText("Midnight Signal")).toBeInTheDocument();
  });

  it("shows retained paused progress, a pending removal, and cover-safe actions", () => {
    const item = generation({
      kind: "cover",
      model: "music-cover-free",
      title: "Cover / Remix?",
    });
    render(
      <GenerationCard
        generation={item}
        active
        playing={false}
        progress={135}
        removing
        onPlay={vi.fn()}
        onDetails={vi.fn()}
        onUseSettings={vi.fn()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Resume Cover / Remix?" }))
      .toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    expect(screen.getByText(/music-cover-free · Cover/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Use settings/ })).not
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Removing…" })).toBeDisabled();
    expect(screen.getByRole("link", { name: /Download/ })).toHaveAttribute(
      "download",
      "Cover - Remix-.mp3",
    );
  });
});

describe("DetailsDialog", () => {
  it("shows complete metadata, renames, syncs changed props, and closes", async () => {
    const user = userEvent.setup();
    let resolveRename!: () => void;
    const onRename = vi.fn().mockImplementation(() =>
      new Promise<void>((resolve) => {
        resolveRename = resolve;
      })
    );
    const onClose = vi.fn();
    const onRemove = vi.fn();
    const item = generation();
    const { container, rerender } = render(
      <DetailsDialog
        generation={item}
        onClose={onClose}
        onRename={onRename}
        onRemove={onRemove}
        removing={false}
      />,
    );

    expect(screen.getByText("2:05")).toBeInTheDocument();
    expect(screen.getByText("2.4 MB")).toBeInTheDocument();
    expect(screen.getByText("MP3 · 44.1 kHz · 256 kbps")).toBeInTheDocument();
    expect(screen.getByText("Custom lyrics")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download audio/ }))
      .toHaveAttribute(
        "href",
        item.audioUrl,
      );
    expect(screen.getByRole("link", { name: /Download audio/ }))
      .toHaveAttribute(
        "download",
        "Midnight Signal.mp3",
      );
    await user.click(screen.getByRole("button", { name: "Remove track" }));
    expect(onRemove).toHaveBeenCalledWith(item);

    await user.click(screen.getByRole("button", { name: "Rename track" }));
    const input = screen.getByLabelText("Track title");
    await user.clear(input);
    await user.type(input, "Renamed");
    await user.click(screen.getByRole("button", { name: "Save title" }));
    expect(screen.getByRole("button", { name: "Save title" })).toBeDisabled();
    resolveRename();
    await waitFor(() => expect(onRename).toHaveBeenCalledWith(item, "Renamed"));
    await waitFor(() => expect(screen.queryByLabelText("Track title")).not.toBeInTheDocument());

    rerender(
      <DetailsDialog
        generation={{ ...item, title: "Server title" }}
        onClose={onClose}
        onRename={onRename}
        onRemove={onRemove}
        removing={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Rename track" }));
    expect(screen.getByLabelText("Track title")).toHaveValue("Server title");
    await user.click(screen.getByRole("button", { name: "Close details" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(container.querySelector(".detail-dialog")!);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(container.querySelector(".dialog-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("cancels empty and unchanged renames", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(
      <DetailsDialog
        generation={generation()}
        onClose={vi.fn()}
        onRename={onRename}
        onRemove={vi.fn()}
        removing={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Rename track" }));
    await user.click(screen.getByRole("button", { name: "Save title" }));
    expect(onRename).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Rename track" }));
    await user.clear(screen.getByLabelText("Track title"));
    await user.click(screen.getByRole("button", { name: "Save title" }));
    expect(onRename).not.toHaveBeenCalled();
  });

  it("covers instrumental, auto-lyrics, fallback, error, and optional metadata states", () => {
    const common = {
      onClose: vi.fn(),
      onRename: vi.fn().mockResolvedValue(undefined),
      onRemove: vi.fn().mockResolvedValue(undefined),
      removing: false,
    };
    const { rerender } = render(
      <DetailsDialog
        generation={generation({
          instrumental: true,
          prompt: "",
          audioUrl: null,
          traceId: null,
          errorMessage: "Provider failed",
          errorCode: "provider_error",
          durationMs: null,
          sizeBytes: null,
        })}
        {...common}
      />,
    );
    expect(screen.getByText("Instrumental")).toBeInTheDocument();
    expect(screen.getByText("No style prompt supplied.")).toBeInTheDocument();
    expect(screen.getByText("Error · provider_error")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Download audio/ })).not
      .toBeInTheDocument();
    expect(screen.queryByText("Lyrics", { selector: "h3" })).not
      .toBeInTheDocument();

    rerender(
      <DetailsDialog
        generation={generation({
          lyricsOptimizer: true,
          lyrics: "",
          traceId: null,
          errorMessage: null,
        })}
        {...common}
      />,
    );
    expect(screen.getByText("Auto lyrics")).toBeInTheDocument();
    expect(screen.getByText(/Lyrics were generated by MiniMax/))
      .toBeInTheDocument();
    expect(screen.queryByText(/MiniMax trace/)).not.toBeInTheDocument();

    rerender(
      <DetailsDialog
        generation={generation({
          kind: "cover",
          model: "music-cover",
        })}
        {...common}
        removing
      />,
    );
    expect(screen.getByText("Cover")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Removing…" })).toBeDisabled();

    rerender(
      <DetailsDialog
        generation={generation({ status: "generating", audioUrl: null })}
        {...common}
      />,
    );
    expect(
      screen.getByRole("button", {
        name: "Cannot remove Midnight Signal while generating",
      }),
    ).toBeDisabled();
  });
});

describe("Player", () => {
  function playerProps(overrides: Partial<PlayerProps> = {}): PlayerProps {
    const current = generation({ id: "middle", instrumental: true });
    return {
      generation: current,
      queue: [current],
      previous: null,
      next: null,
      playing: false,
      elapsed: 0,
      duration: 125.4,
      playbackRate: 1,
      volume: 0.8,
      muted: false,
      queueOpen: false,
      onSelect: vi.fn(),
      onPlayingChange: vi.fn(),
      onElapsedChange: vi.fn(),
      onDurationChange: vi.fn(),
      onPlaybackRateChange: vi.fn(),
      onVolumeChange: vi.fn(),
      onMutedChange: vi.fn(),
      onQueueToggle: vi.fn(),
      onClose: vi.fn(),
      ...overrides,
    };
  }

  it("runs custom transport, seek, speed, volume, download, and media events", async () => {
    const user = userEvent.setup();
    const current = generation({ id: "middle", instrumental: true });
    const previous = generation({ id: "previous", title: "Previous" });
    const next = generation({ id: "next", title: "Next" });
    const onSelect = vi.fn();
    const onPlayingChange = vi.fn();
    const onElapsedChange = vi.fn();
    const onDurationChange = vi.fn();
    const onPlaybackRateChange = vi.fn();
    const onVolumeChange = vi.fn();
    const onMutedChange = vi.fn();
    const onQueueToggle = vi.fn();
    const onClose = vi.fn();
    const props = playerProps({
      generation: current,
      queue: [previous, current, next],
      previous,
      next,
      playing: true,
      elapsed: 12.5,
      onSelect,
      onPlayingChange,
      onElapsedChange,
      onDurationChange,
      onPlaybackRateChange,
      onVolumeChange,
      onMutedChange,
      onQueueToggle,
      onClose,
    });
    const { container } = render(
      <Player {...props} />,
    );
    const audio = container.querySelector("audio")!;
    expect(audio).not.toHaveAttribute("controls");
    await waitFor(() => expect(audio.play).toHaveBeenCalled());
    expect(screen.getByText(/Instrumental · music-3.0-free/))
      .toBeInTheDocument();
    expect(screen.getByText("0:12")).toBeInTheDocument();
    expect(screen.getByText("2:05")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Previous track" }));
    await user.click(screen.getByRole("button", { name: "Next track" }));
    await user.click(screen.getByRole("button", { name: "Pause track" }));
    expect(onPlayingChange).toHaveBeenCalledWith(false);

    fireEvent.change(
      screen.getByRole("slider", { name: "Seek through track" }),
      {
        target: { value: "40" },
      },
    );
    expect(audio.currentTime).toBe(40);
    expect(onElapsedChange).toHaveBeenCalledWith(40);

    Object.defineProperty(audio, "duration", {
      configurable: true,
      value: 130,
    });
    fireEvent.loadedMetadata(audio);
    fireEvent.durationChange(audio);
    expect(onDurationChange).toHaveBeenCalledWith(130);
    Object.defineProperty(audio, "currentTime", {
      configurable: true,
      value: 41,
    });
    fireEvent.timeUpdate(audio);
    expect(onElapsedChange).toHaveBeenCalledWith(41);
    fireEvent.play(audio);
    fireEvent.pause(audio);
    fireEvent.error(audio);

    fireEvent.ended(audio);
    expect(onSelect.mock.calls).toEqual([[previous], [next], [next]]);

    await user.selectOptions(screen.getByLabelText("Playback speed"), "1.5");
    expect(onPlaybackRateChange).toHaveBeenCalledWith(1.5);
    fireEvent.change(screen.getByRole("slider", { name: "Volume" }), {
      target: { value: "0.25" },
    });
    expect(onVolumeChange).toHaveBeenCalledWith(0.25);
    await user.click(screen.getByRole("button", { name: "Mute" }));
    expect(onMutedChange).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole("button", { name: "Open queue" }));
    expect(onQueueToggle).toHaveBeenCalled();

    expect(screen.getByRole("link", { name: "Download playing track" }))
      .toHaveAttribute("href", current.audioUrl);
    expect(screen.getByRole("link", { name: "Download playing track" }))
      .toHaveAttribute("download", "Midnight Signal.mp3");
    await user.click(screen.getByRole("button", { name: "Close player" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders and operates the queue, including active paused and empty states", async () => {
    const user = userEvent.setup();
    const current = generation({
      id: "cover",
      kind: "cover",
      model: "music-cover-free",
      title: "Cover",
    });
    const other = generation({ id: "other", title: "Other", durationMs: null });
    const onSelect = vi.fn();
    const onQueueToggle = vi.fn();
    const props = playerProps({
      generation: current,
      queue: [current, other],
      duration: 0,
      queueOpen: true,
      onSelect,
      onQueueToggle,
    });
    const { rerender } = render(<Player {...props} />);

    expect(screen.getByText(/Cover · music-cover-free/)).toBeInTheDocument();
    expect(screen.getByLabelText("Playback queue")).toBeInTheDocument();
    expect(screen.getByText("2 tracks")).toBeInTheDocument();
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play Cover from queue" }))
      .toHaveAttribute("aria-current", "true");
    await user.click(
      screen.getByRole("button", { name: "Play Other from queue" }),
    );
    expect(onSelect).toHaveBeenCalledWith(other);
    await user.click(
      screen.getByRole("button", { name: "Close playback queue" }),
    );
    expect(onQueueToggle).toHaveBeenCalled();

    rerender(<Player {...props} queue={[current]} playing />);
    expect(screen.getByText("1 track")).toBeInTheDocument();
    expect(screen.getByText("Playing")).toBeInTheDocument();

    rerender(<Player {...props} queue={[]} />);
    expect(screen.getByText("No playable tracks are queued."))
      .toBeInTheDocument();
  });

  it("disables boundaries, falls back for invalid media, and stops at queue end", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onPlayingChange = vi.fn();
    const onDurationChange = vi.fn();
    const { container } = render(
      <Player
        {...playerProps({
          generation: generation({
            audioUrl: null,
            instrumental: false,
            durationMs: null,
          }),
          queue: [],
          duration: Number.POSITIVE_INFINITY,
          elapsed: -5,
          muted: true,
          onSelect,
          onPlayingChange,
          onDurationChange,
        })}
      />,
    );
    expect(screen.getByText(/Vocal · music-3.0-free/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous track" }))
      .toBeDisabled();
    expect(screen.getByRole("button", { name: "Next track" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Download playing track" })).not
      .toBeInTheDocument();
    expect(container.querySelector("audio")).not.toHaveAttribute("src");
    expect(screen.getByRole("slider", { name: "Seek through track" }))
      .toBeDisabled();
    expect(container.querySelector("audio")!.pause).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Play track" }));
    await user.click(screen.getByRole("button", { name: "Unmute" }));
    expect(onPlayingChange).toHaveBeenCalledWith(true);

    fireEvent.loadedMetadata(container.querySelector("audio")!);
    expect(onDurationChange).toHaveBeenCalledWith(0);
    fireEvent.ended(container.querySelector("audio")!);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onPlayingChange).toHaveBeenCalledWith(false);
  });

  it("recovers when browser playback is rejected", async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(
      new Error("blocked"),
    );
    const onPlayingChange = vi.fn();
    render(<Player {...playerProps({ playing: true, onPlayingChange })} />);
    await waitFor(() => expect(onPlayingChange).toHaveBeenCalledWith(false));
  });
});
