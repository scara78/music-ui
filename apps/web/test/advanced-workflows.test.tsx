import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  AdvancedWorkflows,
  CoverWorkflow,
  errorMessage,
  LyricsWorkflow,
  validateCoverLyrics,
  validateCoverPrompt,
  validateLyricsDraft,
  validateReference,
} from "../src/ui/AdvancedWorkflows";
import type { CoverPreprocessResult, GenerateLyricsResult } from "@contracts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

const lyricsResult: GenerateLyricsResult = {
  songTitle: "Silver Signals",
  styleTags: "Synth-pop, Nocturnal, Hopeful",
  lyrics: "[Verse]\nSignals in the rain\n\n[Chorus]\nWe come alive again",
};

const preprocessResult: CoverPreprocessResult = {
  coverFeatureId: "feature-24-hours",
  formattedLyrics: "[Verse]\nOriginal lines here\n\n[Chorus]\nOriginal chorus here",
  structureResult: '{"segments":[{"label":"verse","start":0,"end":30}]}',
  audioDuration: 90,
  traceId: "trace-cover-1",
};

describe("advanced workflow validation", () => {
  it("normalizes thrown values and validates every lyric and cover boundary", () => {
    expect(errorMessage(new Error("Specific"), "Fallback")).toBe("Specific");
    expect(errorMessage("bad", "Fallback")).toBe("Fallback");

    expect(validateLyricsDraft("edit", "   ")).toMatch(/Add the lyrics/);
    expect(validateLyricsDraft("write_full_song", "x".repeat(3501))).toMatch(
      /3,500/,
    );
    expect(validateLyricsDraft("edit", "existing")).toBeNull();

    expect(validateReference("url", "", "", true)).toMatch(/finish loading/);
    expect(validateReference("file", "", "", false)).toMatch(/Choose/);
    expect(validateReference("file", "", "YWJj", false)).toBeNull();
    expect(validateReference("url", "ftp://audio.test/ref.mp3", "", false))
      .toMatch(/http/);
    expect(validateReference("url", " HTTPS://audio.test/ref.mp3 ", "", false))
      .toBeNull();

    expect(validateCoverPrompt("short")).toMatch(/at least 10/);
    expect(validateCoverPrompt("x".repeat(301))).toMatch(/300/);
    expect(validateCoverPrompt("smooth midnight jazz")).toBeNull();

    expect(validateCoverLyrics("", false)).toBeNull();
    expect(validateCoverLyrics("", true)).toMatch(/Add the extracted/);
    expect(validateCoverLyrics("short", false)).toMatch(/at least 10/);
    expect(validateCoverLyrics("x".repeat(1001), false)).toMatch(/1,000/);
    expect(validateCoverLyrics("A complete chorus", true)).toBeNull();
  });
});

describe("AdvancedWorkflows", () => {
  it("switches its accessible workflow tabs without discarding either panel", async () => {
    const user = userEvent.setup();
    render(
      <AdvancedWorkflows
        onGenerateLyrics={vi.fn()}
        onApplyLyricsToSong={vi.fn()}
        onPreprocessCover={vi.fn()}
        onGenerateCover={vi.fn()}
      />,
    );

    const lyricsTab = screen.getByRole("tab", { name: "Lyrics" });
    const coverTab = screen.getByRole("tab", { name: "Cover" });
    expect(lyricsTab).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById(coverTab.getAttribute("aria-controls")!))
      .toHaveAttribute(
        "hidden",
      );

    await user.click(coverTab);
    expect(coverTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Cover studio" })).toBeVisible();

    await user.click(lyricsTab);
    expect(lyricsTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Lyrics studio" }))
      .toBeVisible();
  });
});

describe("LyricsWorkflow", () => {
  it("generates, edits, copies, and applies complete lyric results", async () => {
    const user = userEvent.setup();
    const first = deferred<GenerateLyricsResult>();
    const onGenerate = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ ...lyricsResult, songTitle: "Edited Signals" });
    const onApplyToSong = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { container } = render(
      <LyricsWorkflow onGenerate={onGenerate} onApplyToSong={onApplyToSong} />,
    );

    fireEvent.change(screen.getByPlaceholderText("Neon After Rain"), {
      target: { value: "  Silver Signals  " },
    });
    fireEvent.change(
      screen.getByPlaceholderText("A hopeful night-drive song…"),
      {
        target: { value: "  nocturnal synth pop  " },
      },
    );
    await user.click(screen.getByRole("button", { name: "Generate lyrics" }));
    expect(screen.getByRole("button", { name: "Writing lyrics…" }))
      .toBeDisabled();
    fireEvent.submit(container.querySelector("form")!);
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onGenerate).toHaveBeenCalledWith({
      mode: "write_full_song",
      prompt: "nocturnal synth pop",
      lyrics: undefined,
      title: "Silver Signals",
    });

    act(() => first.resolve(lyricsResult));
    expect(await screen.findByRole("heading", { name: "Silver Signals" }))
      .toBeInTheDocument();
    expect(screen.getByText("Synth-pop, Nocturnal, Hopeful"))
      .toBeInTheDocument();

    const generated = screen.getByLabelText("Generated lyrics");
    fireEvent.change(generated, { target: { value: "" } });
    fireEvent.change(generated, {
      target: { value: "[Verse]\nAn edited line" },
    });
    await user.click(screen.getByRole("button", { name: "Copy lyrics" }));
    expect(writeText).toHaveBeenCalledWith("[Verse]\nAn edited line");
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Use in song/ }));
    expect(onApplyToSong).toHaveBeenCalledWith({
      ...lyricsResult,
      lyrics: "[Verse]\nAn edited line",
    });

    await user.click(
      screen.getByRole("button", { name: "Edit lyrics", pressed: false }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Add the lyrics");
    fireEvent.submit(container.querySelector("form")!);
    expect(onGenerate).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByPlaceholderText("Neon After Rain"), {
      target: { value: "" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("Make the chorus more hopeful…"),
      {
        target: { value: "" },
      },
    );
    fireEvent.change(screen.getByLabelText(/Existing lyrics/), {
      target: { value: "Existing lyrics to continue" },
    });
    await user.click(
      within(container.querySelector("form")!).getByRole("button", {
        name: "Edit lyrics",
      }),
    );
    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(2));
    expect(onGenerate).toHaveBeenLastCalledWith({
      mode: "edit",
      prompt: undefined,
      lyrics: "Existing lyrics to continue",
      title: undefined,
    });

    await user.click(screen.getByRole("button", { name: "Write a song" }));
    expect(screen.queryByLabelText(/Existing lyrics/)).not.toBeInTheDocument();
  });

  it("surfaces generation and clipboard failures", async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn()
      .mockRejectedValueOnce(new Error("Lyrics service unavailable"))
      .mockResolvedValueOnce(lyricsResult);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue("denied") },
    });
    render(<LyricsWorkflow onGenerate={onGenerate} onApplyToSong={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Generate lyrics" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Lyrics service unavailable",
    );
    await user.click(screen.getByRole("button", { name: "Generate lyrics" }));
    expect(await screen.findByRole("heading", { name: "Silver Signals" }))
      .toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy lyrics" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not copy the lyrics",
    );
  });
});

describe("CoverWorkflow", () => {
  it("submits a one-step URL cover with every output option", async () => {
    const user = userEvent.setup();
    const pending = deferred<unknown>();
    const onGenerate = vi.fn().mockReturnValue(pending.promise);
    const { container } = render(
      <CoverWorkflow onPreprocess={vi.fn()} onGenerate={onGenerate} />,
    );

    await user.click(screen.getByRole("button", { name: "One-step" }));
    expect(screen.getByRole("alert")).toHaveTextContent("public http");
    fireEvent.change(
      screen.getByPlaceholderText("https://example.com/reference.mp3"),
      {
        target: { value: "https://audio.test/original.wav" },
      },
    );
    expect(screen.getByRole("alert")).toHaveTextContent("at least 10");
    fireEvent.change(screen.getByPlaceholderText(/Smooth late-night jazz/), {
      target: { value: "Smooth nocturnal jazz with warm saxophone" },
    });
    fireEvent.change(screen.getByPlaceholderText("Late-night lounge cover"), {
      target: { value: "  Lounge Signal  " },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/Leave empty to extract lyrics/),
      {
        target: { value: "  Replacement chorus words  " },
      },
    );

    await user.click(screen.getByRole("button", { name: "Paid" }));
    await user.click(screen.getByRole("button", { name: /Free · 3 RPM/ }));
    await user.click(screen.getByRole("button", { name: "Paid" }));
    await user.selectOptions(screen.getByLabelText("Cover format"), "wav");
    await user.selectOptions(
      screen.getByLabelText("Cover sample rate"),
      "16000",
    );
    await user.selectOptions(screen.getByLabelText("Cover bitrate"), "32000");

    await user.click(screen.getByRole("button", { name: "Generate cover" }));
    expect(screen.getByRole("button", { name: "Generating cover…" }))
      .toBeDisabled();
    expect(screen.getByLabelText("Cover format")).toBeDisabled();
    fireEvent.submit(container.querySelector("form")!);
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onGenerate).toHaveBeenCalledWith({
      title: "Lounge Signal",
      model: "music-cover",
      prompt: "Smooth nocturnal jazz with warm saxophone",
      lyrics: "Replacement chorus words",
      source: { type: "url", url: "https://audio.test/original.wav" },
      audio: { format: "wav", sampleRate: 16000, bitrate: 32000 },
    });

    act(() => pending.resolve(undefined));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "added to the generation queue",
    );
  });

  it("encodes local files as raw base64 and validates file selection and size", async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    render(<CoverWorkflow onPreprocess={vi.fn()} onGenerate={onGenerate} />);

    await user.click(screen.getByRole("button", { name: "Local file" }));
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });

    const tooLarge = new File(["x"], "huge.wav", { type: "audio/wav" });
    Object.defineProperty(tooLarge, "size", { value: 50 * 1024 * 1024 + 1 });
    fireEvent.change(input, { target: { files: [tooLarge] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "50 MB or smaller",
    );

    const file = new File(["abc"], "reference.mp3", { type: "audio/mpeg" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText("reference.mp3")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Smooth late-night jazz/), {
      target: { value: "Dreamy chamber pop with bright strings" },
    });
    await user.click(screen.getByRole("button", { name: "Generate cover" }));
    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));
    expect(onGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: undefined,
        lyrics: undefined,
        source: { type: "base64", data: "YWJj" },
      }),
    );

    await user.click(screen.getByRole("button", { name: "URL" }));
    expect(screen.getByPlaceholderText("https://example.com/reference.mp3"))
      .toBeInTheDocument();
  });

  it("shows file reading progress and reports a FileReader failure", async () => {
    const user = userEvent.setup();
    let activeReader: {
      result: string | null;
      onload: null | (() => void);
      onerror: null | (() => void);
    } | null = null;
    class DeferredReader {
      result: string | null = null;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      constructor() {
        activeReader = this;
      }
      readAsDataURL() {}
    }
    vi.stubGlobal("FileReader", DeferredReader);
    const { rerender } = render(
      <CoverWorkflow onPreprocess={vi.fn()} onGenerate={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Local file" }));
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [new File(["ok"], "loading.wav", { type: "audio/wav" })],
      },
    });
    expect(screen.getByText("Reading reference…")).toBeInTheDocument();
    (activeReader as unknown as { result: string }).result = "data:audio/wav;base64,b2s=";
    act(() => activeReader!.onload!());
    await waitFor(() => expect(screen.getByText("loading.wav")).toBeInTheDocument());

    class BrokenReader {
      result: string | null = null;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      readAsDataURL() {
        this.onerror!();
      }
    }
    vi.stubGlobal("FileReader", BrokenReader);
    rerender(<CoverWorkflow onPreprocess={vi.fn()} onGenerate={vi.fn()} />);
    fireEvent.change(input, {
      target: {
        files: [new File(["bad"], "broken.wav", { type: "audio/wav" })],
      },
    });
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Could not read that audio file",
      )
    );
  });

  it("preprocesses a two-step cover, exposes metadata, and generates from its feature", async () => {
    const user = userEvent.setup();
    const preparing = deferred<CoverPreprocessResult>();
    const generating = deferred<unknown>();
    const onPreprocess = vi.fn().mockReturnValue(preparing.promise);
    const onGenerate = vi.fn().mockReturnValue(generating.promise);
    const { container } = render(
      <CoverWorkflow onPreprocess={onPreprocess} onGenerate={onGenerate} />,
    );

    await user.click(screen.getByRole("button", { name: "Two-step" }));
    fireEvent.change(
      screen.getByPlaceholderText("https://example.com/reference.mp3"),
      {
        target: { value: "https://audio.test/reference.mp3" },
      },
    );
    await user.click(screen.getByRole("button", { name: "Prepare reference" }));
    expect(screen.getByRole("button", { name: "Preparing audio…" }))
      .toBeDisabled();
    fireEvent.submit(container.querySelector("form")!);
    expect(onPreprocess).toHaveBeenCalledTimes(1);
    expect(onPreprocess).toHaveBeenCalledWith({
      source: { type: "url", url: "https://audio.test/reference.mp3" },
    });

    act(() => preparing.resolve(preprocessResult));
    expect(await screen.findByLabelText("Preprocess metadata"))
      .toHaveTextContent(
        "feature-24-hours",
      );
    expect(screen.getByLabelText("Preprocess metadata")).toHaveTextContent(
      "1:30",
    );
    expect(screen.getByLabelText("Preprocess metadata")).toHaveTextContent(
      "trace-cover-1",
    );
    expect(screen.getByText(preprocessResult.structureResult))
      .toBeInTheDocument();
    expect(screen.getByLabelText(/Extracted lyrics/)).toHaveValue(
      preprocessResult.formattedLyrics,
    );

    const extracted = screen.getByLabelText(/Extracted lyrics/);
    fireEvent.change(extracted, { target: { value: "" } });
    expect(screen.getByRole("alert")).toHaveTextContent("at least 10");
    fireEvent.change(screen.getByPlaceholderText(/Smooth late-night jazz/), {
      target: { value: "Bright alternative rock with live drums" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Add the extracted");
    fireEvent.change(extracted, {
      target: { value: "[Verse]\nChanged cover words" },
    });
    await user.click(screen.getByRole("button", { name: "Generate cover" }));
    expect(screen.getByRole("button", { name: "Generating cover…" }))
      .toBeDisabled();
    fireEvent.submit(container.querySelector("form")!);
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { type: "feature", featureId: "feature-24-hours" },
        lyrics: "[Verse]\nChanged cover words",
      }),
    );

    act(() => generating.resolve(undefined));
    expect(await screen.findByRole("status")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Replace reference" }));
    expect(screen.getByRole("button", { name: "Prepare reference" }))
      .toBeInTheDocument();
  });

  it(
    "surfaces preprocess and generation failures and handles missing trace metadata",
    async () => {
      const user = userEvent.setup();
      const withoutTrace = { ...preprocessResult, traceId: null };
      const onPreprocess = vi.fn()
        .mockRejectedValueOnce(new Error("Preprocess failed"))
        .mockResolvedValueOnce(withoutTrace);
      const onGenerate = vi.fn().mockRejectedValueOnce(
        new Error("Cover failed"),
      );
      render(
        <CoverWorkflow onPreprocess={onPreprocess} onGenerate={onGenerate} />,
      );

      await user.click(screen.getByRole("button", { name: "Two-step" }));
      fireEvent.change(
        screen.getByPlaceholderText("https://example.com/reference.mp3"),
        {
          target: { value: "https://audio.test/reference.mp3" },
        },
      );
      await user.click(
        screen.getByRole("button", { name: "Prepare reference" }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Preprocess failed",
      );
      await user.click(
        screen.getByRole("button", { name: "Prepare reference" }),
      );
      expect(await screen.findByText("Not returned")).toBeInTheDocument();

      fireEvent.change(screen.getByPlaceholderText(/Smooth late-night jazz/), {
        target: { value: "Acoustic folk with close harmonies" },
      });
      await user.click(screen.getByRole("button", { name: "Generate cover" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Cover failed",
      );

      await user.click(screen.getByRole("button", { name: "One-step" }));
      expect(screen.getByPlaceholderText("https://example.com/reference.mp3"))
        .toBeInTheDocument();
      expect(screen.queryByLabelText("Preprocess metadata")).not
        .toBeInTheDocument();
    },
    10_000,
  );
});
