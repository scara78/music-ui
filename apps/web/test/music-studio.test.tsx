import type { AppConfig, Generation, GenerationListResponse } from "@contracts";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MusicApi } from "../src/lib/api";
import { MusicStudio } from "../src/ui/MusicStudio";
import { configuredApp, generation } from "./fixtures";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function list(
  items: Generation[],
  total = items.length,
): GenerationListResponse {
  return { items, total };
}

function mockApi(
  items: Generation[] = [],
  config: AppConfig = configuredApp,
): MusicApi & Record<keyof MusicApi, ReturnType<typeof vi.fn>> {
  return {
    config: vi.fn().mockResolvedValue(config),
    generations: vi.fn().mockResolvedValue(list(items)),
    create: vi.fn().mockImplementation((input) =>
      Promise.resolve(
        generation({
          id: "created",
          title: input.title ?? "Created track",
          prompt: input.prompt,
          status: "queued",
          audioUrl: null,
        }),
      )
    ),
    generateLyrics: vi.fn().mockResolvedValue({
      songTitle: "Glass Horizon",
      styleTags: "cinematic synth-pop, bright alto vocal",
      lyrics: "[Verse]\nCity lights become a constellation",
    }),
    preprocessCover: vi.fn().mockResolvedValue({
      coverFeatureId: "feature-24h",
      formattedLyrics: "[Verse]\nA reference line ready to reshape",
      structureResult: '{"sections":["verse"]}',
      audioDuration: 73.4,
      traceId: "trace-cover",
    }),
    rename: vi.fn().mockImplementation((id, title) => Promise.resolve(generation({ id, title }))),
    retry: vi.fn().mockImplementation((id) =>
      Promise.resolve(
        generation({
          id: `${id}-retry`,
          title: "Retry",
          status: "queued",
          audioUrl: null,
        }),
      )
    ),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

async function renderStudio(api: MusicApi) {
  const result = render(<MusicStudio api={api} />);
  await screen.findByText("Recent generations");
  return result;
}

function sidebarButton(name: "Create" | "Library" | "Settings" | "Docs") {
  return screen.getAllByRole("button", { name: new RegExp(`^${name}`) })[0]!;
}

describe("MusicStudio startup", () => {
  it("shows its boot screen, applies server defaults, and warns when the key is missing", async () => {
    const configResult = deferred<AppConfig>();
    const generationsResult = deferred<GenerationListResponse>();
    const api = mockApi();
    api.config.mockReturnValue(configResult.promise);
    api.generations.mockReturnValue(generationsResult.promise);
    const missing: AppConfig = {
      ...configuredApp,
      apiKeyConfigured: false,
      defaultModel: "music-3.0",
      freeRateLimitRpm: 7,
    };

    render(<MusicStudio api={api} />);
    expect(screen.getByText(/Opening your studio/)).toBeInTheDocument();
    configResult.resolve(missing);
    generationsResult.resolve(list([]));

    expect(await screen.findByText("Your first track starts here"))
      .toBeInTheDocument();
    expect(screen.getByText("Connect MiniMax to generate."))
      .toBeInTheDocument();
    expect(screen.getByText("API key needed")).toBeInTheDocument();
    expect(screen.getByText("music-3.0 · 7 RPM")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByText("Advanced output"));
    expect(screen.getByLabelText("Model")).toHaveValue("music-3.0");
    await user.click(sidebarButton("Settings"));
    expect(screen.getByText("Missing API key")).toBeInTheDocument();
  });

  it("reports Error and non-Error startup failures", async () => {
    const api = mockApi();
    api.config.mockRejectedValue(new Error("Configuration offline"));
    const { unmount } = render(<MusicStudio api={api} />);
    expect(await screen.findByText("Configuration offline"))
      .toBeInTheDocument();
    unmount();

    const fallback = mockApi();
    fallback.generations.mockRejectedValue("offline");
    render(<MusicStudio api={fallback} />);
    expect(await screen.findByText("Could not open the studio."))
      .toBeInTheDocument();
  });

  it("ignores both successful and rejected startup work after unmount", async () => {
    const successConfig = deferred<AppConfig>();
    const successList = deferred<GenerationListResponse>();
    const success = mockApi();
    success.config.mockReturnValue(successConfig.promise);
    success.generations.mockReturnValue(successList.promise);
    const first = render(<MusicStudio api={success} />);
    first.unmount();
    await act(async () => {
      successConfig.resolve(configuredApp);
      successList.resolve(list([]));
      await Promise.resolve();
    });

    const failure = deferred<AppConfig>();
    const failed = mockApi();
    failed.config.mockReturnValue(failure.promise);
    const second = render(<MusicStudio api={failed} />);
    second.unmount();
    await act(async () => {
      failure.reject(new Error("late"));
      await Promise.resolve();
    });
  });
});

describe("MusicStudio creation and retry flows", () => {
  it("creates a queued track, exposes its notice, and dismisses it", async () => {
    const user = userEvent.setup();
    const api = mockApi();
    const pending = deferred<Generation>();
    api.create.mockReturnValue(pending.promise);
    await renderStudio(api);

    await user.type(
      screen.getByPlaceholderText(/Genre, mood/),
      "ambient bells",
    );
    await user.click(screen.getByRole("button", { name: "Create track" }));
    expect(screen.getByRole("button", { name: /Adding to queue/ }))
      .toBeDisabled();
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "ambient bells" }),
    );

    pending.resolve(
      generation({
        id: "new",
        title: "New queue",
        prompt: "ambient bells",
        status: "queued",
        audioUrl: null,
      }),
    );
    expect(await screen.findByText("New queue")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Track added to the generation queue.",
    );
    expect(sidebarButton("Library")).toHaveTextContent("1");
    await user.click(screen.getByRole("button", { name: "Dismiss notice" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("automatically dismisses success notices after five seconds", async () => {
    const api = mockApi([generation({ title: "Timer source" })]);
    await renderStudio(api);
    vi.useFakeTimers();

    fireEvent.click(sidebarButton("Library"));
    fireEvent.click(screen.getByRole("button", { name: /Use settings/ }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loaded settings from “Timer source”.",
    );

    act(() => vi.advanceTimersByTime(4_999));
    expect(screen.getByRole("status")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("generates lyrics, applies every result field, and returns to the song composer", async () => {
    const user = userEvent.setup();
    const api = mockApi();
    await renderStudio(api);

    const songMode = screen.getByRole("button", { name: "Song" });
    const toolsMode = screen.getByRole("button", { name: "Lyrics & covers" });
    expect(songMode).toHaveAttribute("aria-pressed", "true");
    await user.click(toolsMode);
    expect(toolsMode).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Lyrics and covers" }))
      .toBeInTheDocument();
    await user.click(songMode);
    expect(songMode).toHaveAttribute("aria-pressed", "true");
    await user.click(toolsMode);

    await user.type(
      screen.getByPlaceholderText("A hopeful night-drive song…"),
      "A luminous city reunion",
    );
    await user.click(screen.getByRole("button", { name: "Generate lyrics" }));
    expect(api.generateLyrics).toHaveBeenCalledWith({
      mode: "write_full_song",
      prompt: "A luminous city reunion",
      lyrics: undefined,
      title: undefined,
    });
    expect(await screen.findByText("Glass Horizon")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use in song" }));
    expect(songMode).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByPlaceholderText("Midnight on Avala")).toHaveValue(
      "Glass Horizon",
    );
    expect(screen.getByPlaceholderText(/Genre, mood/)).toHaveValue(
      "cinematic synth-pop, bright alto vocal",
    );
    expect(screen.getByLabelText("Custom lyrics")).toHaveValue(
      "[Verse]\nCity lights become a constellation",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loaded “Glass Horizon” into the song composer.",
    );
    expect(globalThis.scrollTo).toHaveBeenCalledWith({
      top: 0,
      behavior: "smooth",
    });
  });

  it(
    "preprocesses a reference and queues a two-step cover from the create tools",
    async () => {
      const user = userEvent.setup();
      const api = mockApi();
      api.create.mockResolvedValueOnce(
        generation({
          id: "cover-created",
          kind: "cover",
          model: "music-cover",
          title: "Velvet cover",
          status: "queued",
          audioUrl: null,
        }),
      );
      await renderStudio(api);

      await user.click(screen.getByRole("button", { name: "Lyrics & covers" }));
      await user.click(screen.getByRole("tab", { name: "Cover" }));
      await user.click(screen.getByRole("button", { name: "Two-step" }));
      fireEvent.change(
        screen.getByPlaceholderText("https://example.com/reference.mp3"),
        { target: { value: "https://audio.test/reference.mp3" } },
      );
      await user.click(
        screen.getByRole("button", { name: "Prepare reference" }),
      );
      expect(api.preprocessCover).toHaveBeenCalledWith({
        source: { type: "url", url: "https://audio.test/reference.mp3" },
      });
      expect(await screen.findByText("feature-24h")).toBeInTheDocument();

      fireEvent.change(screen.getByPlaceholderText(/Smooth late-night jazz/), {
        target: { value: "Velvet soul with brushed drums" },
      });
      fireEvent.change(screen.getByPlaceholderText("Late-night lounge cover"), {
        target: { value: "Velvet cover" },
      });
      await user.click(screen.getByRole("button", { name: "Paid" }));
      await user.selectOptions(screen.getByLabelText("Cover format"), "wav");
      await user.selectOptions(
        screen.getByLabelText("Cover sample rate"),
        "32000",
      );
      await user.selectOptions(
        screen.getByLabelText("Cover bitrate"),
        "128000",
      );
      await user.click(screen.getByRole("button", { name: "Generate cover" }));

      expect(api.create).toHaveBeenCalledWith({
        model: "music-cover",
        source: { type: "feature", featureId: "feature-24h" },
        prompt: "Velvet soul with brushed drums",
        lyrics: "[Verse]\nA reference line ready to reshape",
        title: "Velvet cover",
        audio: { format: "wav", sampleRate: 32000, bitrate: 128000 },
      });
      expect(await screen.findByText("Cover added to the generation queue."))
        .toBeInTheDocument();
      expect(sidebarButton("Library")).toHaveTextContent("1");
    },
    10_000,
  );

  it("reports Error and non-Error creation failures and dismisses the alert", async () => {
    const user = userEvent.setup();
    const api = mockApi();
    api.create.mockRejectedValueOnce(new Error("Create exploded"))
      .mockRejectedValueOnce("bad");
    await renderStudio(api);
    await user.type(screen.getByPlaceholderText(/Genre, mood/), "valid prompt");

    await user.click(screen.getByRole("button", { name: "Create track" }));
    expect(await screen.findByText("Create exploded")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dismiss error" }));
    await user.click(screen.getByRole("button", { name: "Create track" }));
    expect(await screen.findByText("Could not start generation."))
      .toBeInTheDocument();
  });

  it("queues a retry and reports both retry failure forms", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    const failedOne = generation({
      id: "failed-1",
      title: "Broken one",
      status: "failed",
      audioUrl: null,
      errorMessage: "nope",
    });
    const failedTwo = generation({
      id: "failed-2",
      title: "Broken two",
      status: "failed",
      audioUrl: null,
      errorMessage: "nope",
    });
    const api = mockApi([failedOne, failedTwo]);
    api.retry
      .mockResolvedValueOnce(
        generation({
          id: "retry-new",
          title: "Fresh retry",
          status: "queued",
          audioUrl: null,
        }),
      )
      .mockRejectedValueOnce(new Error("Retry exploded"))
      .mockRejectedValueOnce("bad");
    await renderStudio(api);

    const retries = screen.getAllByRole("button", { name: /Retry/ });
    await user.click(retries[0]!);
    expect(await screen.findByText("Fresh retry")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "A fresh retry was queued",
    );
    expect(sidebarButton("Library")).toHaveTextContent("3");
    await user.click(screen.getByRole("button", { name: "Dismiss notice" }));

    await user.click(screen.getAllByRole("button", { name: /Retry/ })[1]!);
    expect(await screen.findByText("Retry exploded")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dismiss error" }));
    await user.click(screen.getAllByRole("button", { name: /Retry/ })[1]!);
    expect(await screen.findByText("Could not retry generation."))
      .toBeInTheDocument();
  });
});

describe("MusicStudio navigation, library, settings, and reuse", () => {
  it("navigates through desktop, drawer, and mobile controls", async () => {
    const user = userEvent.setup();
    await renderStudio(mockApi([generation()]));

    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(document.querySelector(".sidebar")).toHaveClass("is-open");
    await user.click(screen.getByRole("button", { name: "Close navigation" }));
    expect(document.querySelector(".sidebar")).not.toHaveClass("is-open");

    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    await user.click(
      screen.getByRole("button", { name: "Close navigation overlay" }),
    );
    expect(document.querySelector(".sidebar")).not.toHaveClass("is-open");

    await user.click(sidebarButton("Library"));
    expect(screen.getByRole("heading", { name: "Library" }))
      .toBeInTheDocument();
    await user.click(sidebarButton("Create"));
    expect(screen.getByRole("heading", { name: "Shape a new track" }))
      .toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Library" }));
    expect(screen.getByRole("heading", { name: "Library" }))
      .toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /New track/ }));
    expect(screen.getByRole("heading", { name: "Shape a new track" }))
      .toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: /^Settings$/ })[1]!);
    expect(screen.getByRole("heading", { name: "Studio settings" }))
      .toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /^Create$/ })[1]!);
    expect(screen.getByText("Recent generations")).toBeInTheDocument();
  });

  it("opens the prompting docs from desktop, Help, and mobile navigation", async () => {
    const user = userEvent.setup();
    await renderStudio(mockApi());

    await user.click(sidebarButton("Docs"));
    expect(sidebarButton("Docs")).toHaveClass("is-active");
    expect(screen.getByRole("heading", { name: "Prompting guide" }))
      .toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sound prompting" }))
      .toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Vocal and lyric modes" }))
      .toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Structure tags" }))
      .toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Structure tags" }).closest(
        "article",
      ),
    )
      .toHaveTextContent("[Solo]");
    expect(screen.getByLabelText("Structured lyric example"))
      .toHaveTextContent("[Pre Chorus]");
    expect(screen.getByRole("heading", { name: "Audio settings" }))
      .toBeInTheDocument();
    expect(screen.getByText(/sample rate of 16/)).toHaveTextContent("44.1 kHz");
    expect(screen.getByRole("heading", { name: "History, reuse, and retry" }))
      .toBeInTheDocument();
    expect(screen.getByText(/MiniMax does not expose/)).toHaveTextContent(
      "Load more",
    );
    expect(screen.getByRole("heading", { name: "Free vs paid" }))
      .toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Free vs paid" }).closest("article"),
    )
      .toHaveTextContent("three requests per minute");

    await user.click(sidebarButton("Create"));
    await user.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.getByText("Music 3 docs")).toBeInTheDocument();

    const mobileNavigation = screen.getByRole("navigation", {
      name: "Mobile navigation",
    });
    await user.click(
      within(mobileNavigation).getByRole("button", { name: "Create" }),
    );
    await user.click(
      within(mobileNavigation).getByRole("button", { name: "Docs" }),
    );
    expect(within(mobileNavigation).getByRole("button", { name: "Docs" }))
      .toHaveClass("is-active");
    expect(screen.getByRole("heading", { name: "Prompting guide" }))
      .toBeInTheDocument();
  });

  it("searches and filters the library and shows its empty result", async () => {
    const user = userEvent.setup();
    const items = [
      generation({ id: "ready", title: "Blue ready", status: "completed" }),
      generation({
        id: "queued",
        title: "Blue queue",
        status: "queued",
        audioUrl: null,
      }),
      generation({
        id: "generating",
        title: "Working",
        status: "generating",
        audioUrl: null,
      }),
      generation({
        id: "failed",
        title: "Failed",
        status: "failed",
        audioUrl: null,
        errorMessage: "x",
      }),
    ];
    await renderStudio(mockApi(items));
    await user.click(sidebarButton("Library"));
    expect(screen.getByText("Showing 4 of 4 loaded tracks · 4 total"))
      .toBeInTheDocument();

    await user.type(screen.getByLabelText("Search library"), "blue");
    expect(screen.getByText("Showing 2 of 4 loaded tracks · 4 total"))
      .toBeInTheDocument();
    await user.selectOptions(
      screen.getByLabelText("Filter by status"),
      "queued",
    );
    expect(screen.getByText("Showing 1 of 4 loaded tracks · 4 total"))
      .toBeInTheDocument();
    expect(screen.getByText("Blue queue")).toBeInTheDocument();
    await user.selectOptions(
      screen.getByLabelText("Filter by status"),
      "completed",
    );
    expect(screen.getByText("Blue ready")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Search library"));
    await user.type(screen.getByLabelText("Search library"), "missing");
    expect(screen.getByText("No loaded tracks match")).toBeInTheDocument();
    expect(screen.getByText("Try a different search or generation status."))
      .toBeInTheDocument();
  });

  it("loads settings from a generation and returns to Create", async () => {
    const user = userEvent.setup();
    const source = generation({
      title: "Reuse Source",
      prompt: "source prompt",
      model: "music-3.0",
    });
    await renderStudio(mockApi([source]));
    await user.click(screen.getByRole("button", { name: "Lyrics & covers" }));
    await user.click(sidebarButton("Library"));
    await user.click(screen.getByRole("button", { name: /Use settings/ }));
    expect(screen.getByRole("heading", { name: "Shape a new track" }))
      .toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Genre, mood/)).toHaveValue(
      "source prompt",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loaded settings from “Reuse Source”.",
    );
    expect(globalThis.scrollTo).toHaveBeenCalledWith({
      top: 0,
      behavior: "smooth",
    });
  });

  it("refreshes and retries from the Library action wiring", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    const failed = generation({
      id: "library-failed",
      title: "Library failure",
      status: "failed",
      audioUrl: null,
      errorMessage: "failed",
    });
    const retryResult = deferred<Generation>();
    const api = mockApi([failed]);
    api.retry.mockReturnValue(retryResult.promise);
    await renderStudio(api);
    await user.click(sidebarButton("Library"));
    await user.click(screen.getByRole("button", { name: /Refresh/ }));
    await waitFor(() => expect(api.generations).toHaveBeenCalledTimes(2));
    const retry = screen.getByRole("button", { name: "Retry" });
    await user.dblClick(retry);
    expect(api.retry).toHaveBeenCalledWith("library-failed");
    expect(api.retry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Retrying…" })).toBeDisabled();
    retryResult.resolve(
      generation({
        id: "library-retry",
        title: "Library retry",
        status: "queued",
      }),
    );
    expect(await screen.findByText("Library retry")).toBeInTheDocument();
  });

  it("loads archive pages, filters loaded history, and preserves them across first-page refreshes", async () => {
    const user = userEvent.setup();
    const firstPage = Array.from(
      { length: 2 },
      (_, index) => generation({ id: `page-${index}`, title: `Page track ${index}` }),
    );
    const archive = [
      generation({
        id: "archive-2",
        title: "Deep Archive",
        status: "failed",
        audioUrl: null,
        errorMessage: "old failure",
      }),
      generation({ id: "archive-3", title: "Archive tail" }),
    ];
    const refreshed = [
      generation({ id: "page-0", title: "Page track refreshed" }),
      ...firstPage.slice(1),
    ];
    const archiveResult = deferred<GenerationListResponse>();
    const api = mockApi();
    api.generations
      .mockResolvedValueOnce(list(firstPage, 4))
      .mockReturnValueOnce(archiveResult.promise)
      .mockResolvedValueOnce(list(refreshed, 5));
    await renderStudio(api);
    await user.click(sidebarButton("Library"));

    expect(sidebarButton("Library")).toHaveTextContent("4");
    expect(screen.getByText("Showing 2 of 2 loaded tracks · 4 total"))
      .toBeInTheDocument();
    await user.type(screen.getByLabelText("Search library"), "deep archive");
    expect(screen.getByText("No loaded tracks match")).toBeInTheDocument();
    expect(screen.getByText("Load more to search the rest of your history."))
      .toBeInTheDocument();
    await user.clear(screen.getByLabelText("Search library"));
    const loadMore = screen.getByRole("button", { name: "Load more" });
    await user.click(loadMore);
    expect(screen.getByRole("button", { name: "Loading more…" }))
      .toBeDisabled();
    expect(api.generations).toHaveBeenNthCalledWith(2, 2);
    archiveResult.resolve(list(archive, 4));

    expect(await screen.findByText("Deep Archive")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Load more/ })).not
      .toBeInTheDocument();
    await user.type(screen.getByLabelText("Search library"), "deep archive");
    await user.selectOptions(
      screen.getByLabelText("Filter by status"),
      "failed",
    );
    expect(screen.getByText("Showing 1 of 4 loaded tracks · 4 total"))
      .toBeInTheDocument();
    expect(screen.getByText("Deep Archive")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Search library"));
    await user.selectOptions(screen.getByLabelText("Filter by status"), "all");
    await user.click(screen.getByRole("button", { name: /Refresh/ }));
    expect(await screen.findByText("Page track refreshed")).toBeInTheDocument();
    expect(screen.getByText("Deep Archive")).toBeInTheDocument();
    expect(sidebarButton("Library")).toHaveTextContent("5");
    expect(screen.getByRole("button", { name: "Load more" }))
      .toBeInTheDocument();
    expect(api.generations).toHaveBeenNthCalledWith(3, 0);
  });

  it("reports Error and non-Error failures while loading more", async () => {
    const user = userEvent.setup();
    const api = mockApi();
    api.generations
      .mockResolvedValueOnce(list([generation({ title: "First page" })], 3))
      .mockRejectedValueOnce(new Error("Archive exploded"))
      .mockRejectedValueOnce("offline");
    await renderStudio(api);
    await user.click(sidebarButton("Library"));

    await user.click(screen.getByRole("button", { name: /Load more/ }));
    expect(await screen.findByText("Archive exploded")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dismiss error" }));
    await user.click(screen.getByRole("button", { name: /Load more/ }));
    expect(await screen.findByText("Could not load more generations."))
      .toBeInTheDocument();
    expect(api.generations).toHaveBeenNthCalledWith(2, 1);
    expect(api.generations).toHaveBeenNthCalledWith(3, 1);
  });

  it("changes appearance from the sidebar and Settings view", async () => {
    const user = userEvent.setup();
    await renderStudio(mockApi());
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    await user.click(screen.getByRole("button", { name: /Dark theme/ }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    await user.click(screen.getByRole("button", { name: /Light theme/ }));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    await user.click(screen.getByRole("button", { name: /Dark theme/ }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    await user.click(sidebarButton("Settings"));
    expect(screen.getByText("Ready to generate")).toBeInTheDocument();
    expect(screen.getByText("music-3.0-free")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Light$/ }));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    await user.click(screen.getByRole("button", { name: /^Dark$/ }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });
});

describe("MusicStudio details, playback, refresh, and polling", () => {
  it("synchronizes card pause, resume, and retained media progress", async () => {
    const user = userEvent.setup();
    const first = generation({
      id: "first",
      title: "First",
      durationMs: 200_000,
    });
    await renderStudio(mockApi([first]));

    await user.click(screen.getByRole("button", { name: "Play First" }));
    expect(screen.getByRole("button", { name: "Pause First" }))
      .toBeInTheDocument();
    const audio = screen.getByLabelText("Audio player").querySelector("audio")!;
    Object.defineProperty(audio, "duration", {
      configurable: true,
      value: 200,
    });
    fireEvent.loadedMetadata(audio);
    Object.defineProperty(audio, "currentTime", {
      configurable: true,
      value: 50,
    });
    fireEvent.timeUpdate(audio);
    expect(screen.getByRole("progressbar", { name: /First/ }))
      .toHaveAttribute("aria-valuenow", "25");

    await user.click(screen.getByRole("button", { name: "Pause First" }));
    expect(screen.getByRole("button", { name: "Resume First" }))
      .toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /First/ }))
      .toHaveAttribute("aria-valuenow", "25");
    await user.click(screen.getByRole("button", { name: "Resume First" }));
    expect(screen.getByRole("button", { name: "Pause First" }))
      .toBeInTheDocument();
  });

  it("opens a playable queue, excludes PCM, selects tracks, and controls volume", async () => {
    const user = userEvent.setup();
    const first = generation({ id: "first", title: "First" });
    const pcm = generation({
      id: "pcm",
      title: "Raw PCM",
      audio: { sampleRate: 44100, bitrate: 256000, format: "pcm" },
    });
    const last = generation({ id: "last", title: "Last", durationMs: null });
    await renderStudio(mockApi([first, pcm, last]));

    await user.click(screen.getByRole("button", { name: "Play First" }));
    const player = screen.getByLabelText("Audio player");
    await user.click(
      within(player).getByRole("button", { name: "Open queue" }),
    );
    expect(screen.getByRole("button", { name: "Play First from queue" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Play Raw PCM from queue" }))
      .not
      .toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Play Last from queue" }),
    );
    expect(within(player).getByText("Last")).toBeInTheDocument();
    expect(screen.queryByLabelText("Playback queue")).not.toBeInTheDocument();

    fireEvent.change(within(player).getByRole("slider", { name: "Volume" }), {
      target: { value: "0" },
    });
    fireEvent.change(within(player).getByRole("slider", { name: "Volume" }), {
      target: { value: "0.4" },
    });
    await user.click(within(player).getByRole("button", { name: "Mute" }));
    expect(within(player).getByRole("button", { name: "Unmute" }))
      .toBeInTheDocument();
  });

  it("renames details and keeps the active player synchronized", async () => {
    const user = userEvent.setup();
    const first = generation({ id: "first", title: "First" });
    const second = generation({ id: "second", title: "Second" });
    const api = mockApi([first, second]);
    api.rename.mockImplementation((id, title) =>
      Promise.resolve({
        ...(id === "first" ? first : second),
        title,
      })
    );
    await renderStudio(api);

    await user.click(screen.getByRole("button", { name: "Play First" }));
    await user.click(screen.getAllByRole("button", { name: /Details/ })[0]!);
    await user.click(screen.getByRole("button", { name: "Rename track" }));
    await user.clear(screen.getByLabelText("Track title"));
    await user.type(screen.getByLabelText("Track title"), "First renamed");
    await user.click(screen.getByRole("button", { name: "Save title" }));
    await waitFor(() => expect(api.rename).toHaveBeenCalledWith("first", "First renamed"));
    expect(
      within(screen.getByRole("dialog")).getByRole("heading", {
        name: "First renamed",
      }),
    )
      .toBeInTheDocument();
    expect(
      within(screen.getByLabelText("Audio player")).getByText("First renamed"),
    )
      .toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close details" }));

    await user.click(screen.getAllByRole("button", { name: /Details/ })[1]!);
    await user.click(screen.getByRole("button", { name: "Rename track" }));
    await user.clear(screen.getByLabelText("Track title"));
    await user.type(screen.getByLabelText("Track title"), "Second renamed");
    await user.click(screen.getByRole("button", { name: "Save title" }));
    expect(
      within(screen.getByLabelText("Audio player")).getByText("First renamed"),
    )
      .toBeInTheDocument();
  }, 10_000);

  it("computes previous/next boundaries and closes the player", async () => {
    const user = userEvent.setup();
    const first = generation({ id: "first", title: "First" });
    const middle = generation({ id: "middle", title: "Middle" });
    const last = generation({ id: "last", title: "Last" });
    await renderStudio(
      mockApi([
        first,
        middle,
        last,
        generation({ id: "metadata", title: "No audio", audioUrl: null }),
      ]),
    );
    await user.click(screen.getByRole("button", { name: "Play Middle" }));
    const player = screen.getByLabelText("Audio player");
    expect(within(player).getByRole("button", { name: "Previous track" }))
      .toBeEnabled();
    expect(within(player).getByRole("button", { name: "Next track" }))
      .toBeEnabled();
    await user.click(
      within(player).getByRole("button", { name: "Previous track" }),
    );
    expect(within(player).getByText("First")).toBeInTheDocument();
    expect(within(player).getByRole("button", { name: "Previous track" }))
      .toBeDisabled();
    await user.click(
      within(player).getByRole("button", { name: "Next track" }),
    );
    await user.click(
      within(player).getByRole("button", { name: "Next track" }),
    );
    expect(within(player).getByText("Last")).toBeInTheDocument();
    expect(within(player).getByRole("button", { name: "Next track" }))
      .toBeDisabled();
    await user.click(
      within(player).getByRole("button", { name: "Close player" }),
    );
    expect(screen.queryByLabelText("Audio player")).not.toBeInTheDocument();
  });

  it("confirms removal and reconciles list, detail, player, counts, and pagination", async () => {
    const user = userEvent.setup();
    const first = generation({ id: "first", title: "First" });
    const second = generation({ id: "second", title: "Second" });
    const api = mockApi([first, second]);
    api.generations.mockResolvedValueOnce(list([first, second], 3))
      .mockResolvedValueOnce(list([], 2));
    const deletion = deferred<void>();
    api.remove.mockReturnValue(deletion.promise);
    await renderStudio(api);
    await user.click(screen.getByRole("button", { name: "Play First" }));
    await user.click(screen.getAllByRole("button", { name: /Details/ })[0]!);

    await user.click(screen.getByRole("button", { name: "Remove track" }));
    let confirmation = screen.getByRole("dialog", { name: "Remove “First”?" });
    expect(within(confirmation).getByText(/cannot be undone/))
      .toBeInTheDocument();
    fireEvent.keyDown(globalThis, { key: "Enter" });
    expect(screen.getByRole("dialog", { name: "Remove “First”?" }))
      .toBeInTheDocument();
    fireEvent.keyDown(globalThis, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Remove “First”?" })).not
      .toBeInTheDocument();
    expect(api.remove).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Remove track" }));
    confirmation = screen.getByRole("dialog", { name: "Remove “First”?" });
    await user.click(
      within(confirmation).getByRole("button", { name: "Cancel" }),
    );
    expect(screen.queryByRole("dialog", { name: "Remove “First”?" })).not
      .toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove track" }));
    confirmation = screen.getByRole("dialog", { name: "Remove “First”?" });
    await user.click(
      within(confirmation).getByRole("button", { name: "Remove track" }),
    );
    expect(api.remove).toHaveBeenCalledWith("first");
    expect(
      within(screen.getByRole("dialog", { name: "Remove “First”?" })).getByRole(
        "button",
        {
          name: "Removing…",
        },
      ),
    )
      .toBeDisabled();
    fireEvent.keyDown(globalThis, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Remove “First”?" }))
      .toBeInTheDocument();

    deletion.resolve();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByLabelText("Audio player")).not.toBeInTheDocument();
    expect(screen.queryByText("First")).not.toBeInTheDocument();
    expect(screen.getByText("Removed “First”.")).toBeInTheDocument();

    await user.click(sidebarButton("Library"));
    expect(screen.getByText("Showing 1 of 1 loaded tracks · 2 total"))
      .toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(api.generations).toHaveBeenLastCalledWith(1);
  });

  it("keeps records on removal failures and leaves another active player intact", async () => {
    const user = userEvent.setup();
    const first = generation({ id: "first", title: "First" });
    const second = generation({ id: "second", title: "Second" });
    const api = mockApi([first, second]);
    api.remove
      .mockRejectedValueOnce(new Error("Still generating"))
      .mockRejectedValueOnce("bad delete")
      .mockResolvedValueOnce(undefined);
    await renderStudio(api);
    await user.click(screen.getByRole("button", { name: "Play First" }));

    const secondCard = screen.getByText("Second").closest("article")!;
    await user.click(
      within(secondCard).getByRole("button", { name: "Remove" }),
    );
    await user.click(
      within(screen.getByRole("dialog", { name: "Remove “Second”?" }))
        .getByRole("button", {
          name: "Remove track",
        }),
    );
    expect(await screen.findByText("Still generating")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Audio player")).getByText("First"))
      .toBeInTheDocument();

    await user.click(
      within(secondCard).getByRole("button", { name: "Remove" }),
    );
    await user.click(
      within(screen.getByRole("dialog", { name: "Remove “Second”?" }))
        .getByRole("button", {
          name: "Remove track",
        }),
    );
    expect(await screen.findByText("Could not remove the track."))
      .toBeInTheDocument();
    await user.click(
      within(secondCard).getByRole("button", { name: "Remove" }),
    );
    await user.click(
      within(screen.getByRole("dialog", { name: "Remove “Second”?" }))
        .getByRole("button", {
          name: "Remove track",
        }),
    );
    await waitFor(() => expect(screen.queryByText("Second")).not.toBeInTheDocument());
    expect(within(screen.getByLabelText("Audio player")).getByText("First"))
      .toBeInTheDocument();
  });

  it("refreshes lists and synchronized detail/player records, retaining missing current records", async () => {
    const user = userEvent.setup();
    const original = generation({ id: "same", title: "Original" });
    const updated = generation({ id: "same", title: "Updated" });
    const api = mockApi([original]);
    api.generations
      .mockResolvedValueOnce(list([original]))
      .mockResolvedValueOnce(list([updated]))
      .mockResolvedValueOnce(list([]));
    await renderStudio(api);
    await user.click(screen.getByRole("button", { name: "Play Original" }));
    await user.click(screen.getByRole("button", { name: /Details/ }));

    await user.click(screen.getByRole("button", { name: /Refresh/ }));
    expect(
      await within(screen.getByRole("dialog")).findByRole("heading", {
        name: "Updated",
      }),
    )
      .toBeInTheDocument();
    expect(within(screen.getByLabelText("Audio player")).getByText("Updated"))
      .toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Refresh/ }));
    await waitFor(() => expect(api.generations).toHaveBeenCalledTimes(3));
    expect(
      within(screen.getByRole("dialog")).getByRole("heading", {
        name: "Updated",
      }),
    )
      .toBeInTheDocument();
    expect(within(screen.getByLabelText("Audio player")).getByText("Updated"))
      .toBeInTheDocument();
  });

  it("reports both explicit refresh errors and clears a prior error on success", async () => {
    const user = userEvent.setup();
    const api = mockApi();
    api.generations
      .mockResolvedValueOnce(list([]))
      .mockRejectedValueOnce(new Error("Refresh exploded"))
      .mockRejectedValueOnce("bad")
      .mockResolvedValueOnce(list([]));
    await renderStudio(api);

    await user.click(screen.getByRole("button", { name: /Refresh/ }));
    expect(await screen.findByText("Refresh exploded")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dismiss error" }));
    await user.click(screen.getByRole("button", { name: /Refresh/ }));
    expect(await screen.findByText("Could not load generations."))
      .toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Refresh/ }));
    await waitFor(() =>
      expect(screen.queryByText("Could not load generations.")).not
        .toBeInTheDocument()
    );
  });

  it("quietly polls active generations and clears its timer", async () => {
    vi.useFakeTimers();
    const queued = generation({
      id: "queued",
      title: "Queued",
      status: "queued",
      audioUrl: null,
    });
    const api = mockApi([queued]);
    api.generations
      .mockResolvedValueOnce(list([queued]))
      .mockResolvedValueOnce(list([queued]))
      .mockRejectedValueOnce(new Error("quiet failure"));
    const { unmount } = render(<MusicStudio api={api} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Queued")).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(2_500);
      await Promise.resolve();
    });
    expect(api.generations).toHaveBeenCalledTimes(2);
    await act(async () => {
      vi.advanceTimersByTime(2_500);
      await Promise.resolve();
    });
    expect(api.generations).toHaveBeenCalledTimes(3);
    expect(screen.queryByText("quiet failure")).not.toBeInTheDocument();
    unmount();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });
});

describe("MusicStudio default API", () => {
  it("uses HttpMusicApi when no API prop is supplied", async () => {
    vi.resetModules();
    const fetcher = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url === "/api/config" ? configuredApp : list([]),
          ),
          { status: 200 },
        ),
      )
    );
    vi.stubGlobal("fetch", fetcher);
    const { MusicStudio: DefaultStudio } = await import(
      "../src/ui/MusicStudio"
    );
    render(<DefaultStudio />);
    expect(await screen.findByText("Your first track starts here"))
      .toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith("/api/config", undefined);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/generations?limit=100&offset=0",
      undefined,
    );
  });
});
