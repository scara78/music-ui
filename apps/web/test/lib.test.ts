import { DEFAULT_GENERATION_INPUT } from "@contracts";
import { describe, expect, it, vi } from "vitest";
import { HttpMusicApi } from "../src/lib/api";
import {
  draftFromGeneration,
  freshDraft,
  setInstrumental,
  setLyricsMode,
  validateDraft,
} from "../src/lib/draft";
import {
  downloadFilename,
  filterGenerations,
  formatBytes,
  formatDate,
  formatDuration,
  formatPlaybackTime,
  generationHue,
  generationKindLabel,
  isCoverGeneration,
} from "../src/lib/format";
import { applyTheme, initialTheme } from "../src/lib/theme";
import { generation } from "./fixtures";

describe("HttpMusicApi", () => {
  it("uses the default fetcher and reads configuration", async () => {
    let receiver: unknown = globalThis;
    const fetcher = vi.fn(function (this: unknown) {
      receiver = this;
      return Promise.resolve(
        new Response(JSON.stringify({ apiKeyConfigured: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(new HttpMusicApi().config()).resolves.toEqual({
      apiKeyConfigured: true,
    });
    expect(fetcher).toHaveBeenCalledWith("/api/config", undefined);
    expect(receiver).toBeUndefined();
  });

  it("sends every generation request with the expected method and JSON body", async () => {
    const payload = generation();
    const fetcher = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
    );
    const api = new HttpMusicApi(fetcher as typeof fetch);

    await expect(api.generations()).resolves.toEqual(payload);
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/generations?limit=100&offset=0",
      undefined,
    );

    await expect(api.generations(100)).resolves.toEqual(payload);
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/generations?limit=100&offset=100",
      undefined,
    );

    await api.create(DEFAULT_GENERATION_INPUT);
    expect(fetcher).toHaveBeenNthCalledWith(3, "/api/generations", {
      method: "POST",
      body: JSON.stringify(DEFAULT_GENERATION_INPUT),
      headers: { "content-type": "application/json" },
    });

    const lyricsInput = {
      mode: "write_full_song" as const,
      prompt: "City lights",
    };
    await api.generateLyrics(lyricsInput);
    expect(fetcher).toHaveBeenNthCalledWith(4, "/api/lyrics", {
      method: "POST",
      body: JSON.stringify(lyricsInput),
      headers: { "content-type": "application/json" },
    });

    const preprocessInput = {
      source: { type: "url" as const, url: "https://audio.test/source.mp3" },
    };
    await api.preprocessCover(preprocessInput);
    expect(fetcher).toHaveBeenNthCalledWith(5, "/api/covers/preprocess", {
      method: "POST",
      body: JSON.stringify(preprocessInput),
      headers: { "content-type": "application/json" },
    });

    await api.rename("a/b", "New title");
    expect(fetcher).toHaveBeenNthCalledWith(6, "/api/generations/a/b", {
      method: "PATCH",
      body: JSON.stringify({ title: "New title" }),
      headers: { "content-type": "application/json" },
    });

    await api.retry("failed-id");
    expect(fetcher).toHaveBeenNthCalledWith(
      7,
      "/api/generations/failed-id/retry",
      {
        method: "POST",
      },
    );

    await api.remove("obsolete-id");
    expect(fetcher).toHaveBeenNthCalledWith(8, "/api/generations/obsolete-id", {
      method: "DELETE",
    });
  });

  it("accepts an empty successful delete response", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    await expect(new HttpMusicApi(fetcher as typeof fetch).remove("gone"))
      .resolves.toBeUndefined();
  });

  it("surfaces API messages and falls back to the HTTP status", async () => {
    const withMessage = new HttpMusicApi(
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "bad", message: "Readable failure" },
          }),
          { status: 400 },
        ),
      ) as typeof fetch,
    );
    await expect(withMessage.config()).rejects.toThrow("Readable failure");

    const withoutMessage = new HttpMusicApi(
      vi.fn().mockResolvedValue(
        new Response("{}", { status: 503 }),
      ) as typeof fetch,
    );
    await expect(withoutMessage.config()).rejects.toThrow(
      "Request failed (503)",
    );
  });
});

describe("draft helpers", () => {
  it("creates independent default and selected-model drafts", () => {
    const first = freshDraft();
    const paid = freshDraft("music-3.0");
    expect(first).toEqual(DEFAULT_GENERATION_INPUT);
    expect(paid.model).toBe("music-3.0");
    expect(first.audio).not.toBe(DEFAULT_GENERATION_INPUT.audio);
  });

  it("copies every reusable setting from a generation", () => {
    const source = generation({ title: "Reuse me", instrumental: true });
    const draft = draftFromGeneration(source);
    expect(draft).toEqual({
      title: "Reuse me",
      model: source.model,
      prompt: source.prompt,
      lyrics: source.lyrics,
      lyricsOptimizer: source.lyricsOptimizer,
      instrumental: true,
      audio: source.audio,
    });
    expect(draft.audio).not.toBe(source.audio);
  });

  it("validates instrumental, automatic, and handwritten lyric drafts", () => {
    expect(validateDraft({ ...freshDraft(), instrumental: true })).toBe(
      "Describe the instrumental you want to make.",
    );
    expect(
      validateDraft({ ...freshDraft(), instrumental: true, prompt: "piano" }),
    ).toBeNull();
    expect(validateDraft(freshDraft())).toBe(
      "Describe the song so MiniMax can write its lyrics.",
    );
    expect(validateDraft({ ...freshDraft(), prompt: "dream pop" })).toBeNull();
    expect(validateDraft({ ...freshDraft(), lyricsOptimizer: false })).toBe(
      "Add lyrics or switch to Auto lyrics.",
    );
    expect(
      validateDraft({
        ...freshDraft(),
        lyricsOptimizer: false,
        lyrics: "sing",
      }),
    ).toBeNull();
  });

  it("switches instrumental and lyric modes without retaining incompatible values", () => {
    const source = { ...freshDraft(), lyrics: "words", lyricsOptimizer: true };
    expect(setInstrumental(source, true)).toMatchObject({
      instrumental: true,
      lyrics: "",
      lyricsOptimizer: false,
    });
    expect(setInstrumental(source, false)).toMatchObject({
      instrumental: false,
      lyrics: "words",
      lyricsOptimizer: true,
    });
    expect(setLyricsMode({ ...source, instrumental: true }, "auto"))
      .toMatchObject({
        lyrics: "",
        lyricsOptimizer: true,
        instrumental: false,
      });
    expect(setLyricsMode({ ...source, instrumental: true }, "write"))
      .toMatchObject({
        lyrics: "words",
        lyricsOptimizer: false,
        instrumental: false,
      });
  });
});

describe("format helpers", () => {
  it("formats duration boundaries", () => {
    expect(formatDuration(null)).toBe("—:—");
    expect(formatDuration(-300)).toBe("0:00");
    expect(formatDuration(65_499)).toBe("1:05");
  });

  it("formats playback time and safe download names", () => {
    expect(formatPlaybackTime(65.9)).toBe("1:05");
    expect(formatPlaybackTime(-4)).toBe("0:00");
    expect(formatPlaybackTime(Number.NaN)).toBe("0:00");
    expect(downloadFilename(generation())).toBe("Midnight Signal.mp3");
    expect(downloadFilename(generation({ title: "  Mix / demo?. " }))).toBe(
      "Mix - demo-.mp3",
    );
    expect(downloadFilename(generation({ title: "<>:\u0001" }))).toBe(
      "----.mp3",
    );
    expect(downloadFilename(generation({ title: "  ...  " }))).toBe(
      "track.mp3",
    );
  });

  it("labels track and cover output kinds", () => {
    const vocal = generation();
    const instrumental = generation({ instrumental: true });
    const cover = generation({ kind: "cover", model: "music-cover-free" });
    expect(isCoverGeneration(vocal)).toBe(false);
    expect(isCoverGeneration(cover)).toBe(true);
    expect(generationKindLabel(vocal)).toBe("Vocal");
    expect(generationKindLabel(instrumental)).toBe("Instrumental");
    expect(generationKindLabel(cover)).toBe("Cover");
  });

  it("formats unavailable, kilobyte, and megabyte sizes", () => {
    expect(formatBytes(null)).toBe("Not available");
    expect(formatBytes(0)).toBe("1 KB");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1_572_864)).toBe("1.5 MB");
  });

  it("formats relative and calendar dates", () => {
    const now = Date.parse("2026-08-11T12:00:00.000Z");
    expect(formatDate("2026-08-11T11:59:30.000Z", now)).toBe("just now");
    expect(formatDate("2026-08-11T11:30:00.000Z", now)).toBe("30m ago");
    expect(formatDate("2026-08-11T07:00:00.000Z", now)).toBe("5h ago");
    expect(formatDate("2026-08-01T12:00:00.000Z", now)).toBe("Aug 1");
    expect(formatDate("2026-08-12T12:00:00.000Z", now)).toBe("Aug 12");
  });

  it("derives a stable artwork hue", () => {
    expect(generationHue({ id: "AB" })).toBe((65 + 66) % 360);
  });

  it("filters by normalized query and status", () => {
    const items = [
      generation({ id: "a", title: "Blue Moon", status: "completed" }),
      generation({
        id: "b",
        title: "Other",
        prompt: "Piano rain",
        status: "queued",
      }),
      generation({
        id: "c",
        title: "Third",
        lyrics: "BLUE sky",
        status: "failed",
      }),
    ];
    expect(filterGenerations(items, " ", "all")).toEqual(items);
    expect(filterGenerations(items, " blue ", "all")).toEqual([
      items[0],
      items[2],
    ]);
    expect(filterGenerations(items, "piano", "queued")).toEqual([items[1]]);
    expect(filterGenerations(items, "piano", "completed")).toEqual([]);
  });
});

describe("theme helpers", () => {
  it("prefers a valid saved theme, then the system preference", () => {
    expect(initialTheme({ getItem: () => "light" }, true)).toBe("light");
    expect(initialTheme({ getItem: () => "dark" }, false)).toBe("dark");
    expect(initialTheme({ getItem: () => "unknown" }, true)).toBe("dark");
    expect(initialTheme({ getItem: () => null }, false)).toBe("light");
  });

  it("applies and persists a theme", () => {
    const root = document.createElement("html");
    const setItem = vi.fn();
    applyTheme("dark", root, { setItem });
    expect(root).toHaveAttribute("data-theme", "dark");
    expect(setItem).toHaveBeenCalledWith("cadence-theme", "dark");
  });
});
