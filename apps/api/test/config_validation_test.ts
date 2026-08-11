import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";
import {
  parseCoverPreprocess,
  parseCreateGeneration,
  parseGenerateLyrics,
  parseListFilters,
  parseTitle,
  validateTenantId,
} from "../src/validation.ts";
import { captureAppError, makeInput } from "./fixtures.ts";

function reader(values: Record<string, string | undefined>) {
  return (name: string) => values[name];
}

Deno.test("loadConfig supplies safe defaults", () => {
  const config = loadConfig(reader({}));
  assert.deepEqual(config, {
    port: 8787,
    host: "127.0.0.1",
    databasePath: "./data/music.db",
    audioStoragePath: "./data/audio",
    defaultTenantId: "local-user",
    allowTenantHeader: false,
    minimaxApiKey: "",
    minimaxBaseUrl: "https://api.minimax.io",
    defaultModel: "music-3.0-free",
    freeRateLimitRpm: 3,
  });
});

Deno.test("loadConfig reads every override and normalizes a trailing base URL slash", () => {
  const config = loadConfig(reader({
    API_PORT: "9000",
    API_HOST: "0.0.0.0",
    DATABASE_PATH: "custom/db.sqlite",
    AUDIO_STORAGE_PATH: "custom/audio",
    DEFAULT_TENANT_ID: "tenant_a",
    ALLOW_TENANT_HEADER: "TRUE",
    MINIMAX_API_KEY: "secret",
    MINIMAX_BASE_URL: "https://example.test/",
    MINIMAX_MODEL: "music-3.0",
  }));
  assert.equal(config.port, 9000);
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.databasePath, "custom/db.sqlite");
  assert.equal(config.audioStoragePath, "custom/audio");
  assert.equal(config.defaultTenantId, "tenant_a");
  assert.equal(config.allowTenantHeader, true);
  assert.equal(config.minimaxApiKey, "secret");
  assert.equal(config.minimaxBaseUrl, "https://example.test");
  assert.equal(config.defaultModel, "music-3.0");
});

Deno.test("loadConfig treats non-true boolean text as false and preserves a URL without slash", () => {
  const config = loadConfig(reader({
    ALLOW_TENANT_HEADER: "yes",
    MINIMAX_BASE_URL: "http://localhost:9999",
  }));
  assert.equal(config.allowTenantHeader, false);
  assert.equal(config.minimaxBaseUrl, "http://localhost:9999");
});

Deno.test("loadConfig validates integer ports and model names", () => {
  for (const value of ["0", "-1", "1.5", "not-a-number"]) {
    assert.throws(
      () => loadConfig(reader({ API_PORT: value })),
      /API_PORT must be a positive integer/,
    );
  }
  assert.throws(
    () => loadConfig(reader({ MINIMAX_MODEL: "music-from-the-future" })),
    /MINIMAX_MODEL must be one of/,
  );
});

Deno.test("loadConfig default reader consults Deno.env", () => {
  const name = "API_PORT";
  const previous = Deno.env.get(name);
  try {
    Deno.env.set(name, "9123");
    assert.equal(loadConfig().port, 9123);
  } finally {
    if (previous === undefined) Deno.env.delete(name);
    else Deno.env.set(name, previous);
  }
});

Deno.test("parseCreateGeneration accepts vocal, automatic-lyrics, and instrumental requests", () => {
  const vocal = parseCreateGeneration(makeInput());
  assert.equal(vocal.title, "Midnight Current");

  const automatic = parseCreateGeneration(makeInput({
    title: undefined,
    prompt: "Write a bright summer anthem",
    lyrics: "",
    lyricsOptimizer: true,
  }));
  assert.equal(automatic.lyricsOptimizer, true);

  const instrumental = parseCreateGeneration(makeInput({
    prompt: "Slow cinematic strings",
    lyrics: "",
    lyricsOptimizer: false,
    instrumental: true,
  }));
  assert.equal(instrumental.instrumental, true);

  const customLyricsWithoutPrompt = parseCreateGeneration(
    makeInput({ prompt: "" }),
  );
  assert.equal(customLyricsWithoutPrompt.prompt, "");
});

Deno.test("parseCreateGeneration reports all instrumental conflicts", () => {
  const error = captureAppError(() =>
    parseCreateGeneration(makeInput({
      prompt: " ",
      lyrics: "words",
      lyricsOptimizer: true,
      instrumental: true,
    }))
  );
  assert.equal(error.status, 422);
  assert.equal(error.code, "validation_error");
  assert.deepEqual(error.fields, {
    prompt: "Describe the instrumental.",
    lyrics: "Instrumentals cannot include lyrics.",
    lyricsOptimizer: "Automatic lyrics cannot be used for an instrumental.",
  });
});

Deno.test("parseCreateGeneration reports automatic-lyrics conflicts", () => {
  const error = captureAppError(() =>
    parseCreateGeneration(makeInput({
      prompt: "",
      lyrics: "custom words",
      lyricsOptimizer: true,
    }))
  );
  assert.deepEqual(error.fields, {
    prompt: "Describe the song so MiniMax can write its lyrics.",
    lyrics: "Remove custom lyrics when automatic lyrics are enabled.",
  });
});

Deno.test("parseCreateGeneration requires vocal lyrics when optimizer is disabled", () => {
  const error = captureAppError(() => parseCreateGeneration(makeInput({ lyrics: "" })));
  assert.equal(error.fields?.lyrics, "Add lyrics or enable automatic lyrics.");
});

Deno.test("parseCreateGeneration maps structural Zod failures to fields", () => {
  const invalid = {
    ...makeInput(),
    title: " ",
    model: "invalid",
    prompt: "x".repeat(2001),
    lyrics: "x".repeat(3501),
    audio: { sampleRate: 1, bitrate: 2, format: "flac" },
    unexpected: true,
  };
  const error = captureAppError(() => parseCreateGeneration(invalid));
  assert.equal(error.status, 422);
  assert.equal(error.message, "Check the highlighted generation settings.");
  assert.ok(error.fields?.title);
  assert.ok(error.fields?.model);
  assert.ok(error.fields?.prompt);
  assert.ok(error.fields?.lyrics);
  assert.ok(error.fields?.["audio.sampleRate"]);
  assert.ok(error.fields?.["audio.bitrate"]);
  assert.ok(error.fields?.["audio.format"]);
  assert.ok(error.fields?.request);
  assert.equal(captureAppError(() => parseCreateGeneration(null)).status, 422);
});

Deno.test("parseCreateGeneration accepts one-step and two-step cover inputs", () => {
  const common = {
    title: "Cover",
    model: "music-cover-free" as const,
    prompt: "Smooth late-night jazz cover",
    audio: { sampleRate: 44100 as const, bitrate: 256000 as const, format: "mp3" as const },
  };
  assert.deepEqual(
    parseCreateGeneration({
      ...common,
      source: { type: "url", url: "https://audio.example/song.mp3" },
    }),
    {
      ...common,
      source: { type: "url", url: "https://audio.example/song.mp3" },
    },
  );
  assert.deepEqual(
    parseCreateGeneration({
      ...common,
      source: { type: "base64", data: "SUQz" },
      lyrics: "Ten letters of lyrics",
    }),
    {
      ...common,
      source: { type: "base64", data: "SUQz" },
      lyrics: "Ten letters of lyrics",
    },
  );
  assert.deepEqual(
    parseCreateGeneration({
      ...common,
      model: "music-cover",
      source: { type: "feature", featureId: " feature-id " },
      lyrics: " Edited cover words ",
    }),
    {
      ...common,
      model: "music-cover",
      source: { type: "feature", featureId: "feature-id" },
      lyrics: "Edited cover words",
    },
  );
});

Deno.test("parseCreateGeneration validates cover-specific fields and sources", () => {
  const common = {
    model: "music-cover-free",
    prompt: "too short",
    audio: { sampleRate: 44100, bitrate: 256000, format: "mp3" },
  };
  const short = captureAppError(() =>
    parseCreateGeneration({
      ...common,
      source: { type: "feature", featureId: "id" },
      lyrics: "short",
    })
  );
  assert.ok(short.fields?.prompt);
  assert.equal(short.fields?.lyrics, "Cover lyrics must be between 10 and 1000 characters.");

  const missingLyrics = captureAppError(() =>
    parseCreateGeneration({
      ...common,
      prompt: "Long enough cover prompt",
      source: { type: "feature", featureId: "id" },
    })
  );
  assert.equal(missingLyrics.fields?.lyrics, "Two-step covers require edited lyrics.");

  for (
    const source of [
      { type: "url", url: "ftp://audio.example/song.mp3" },
      { type: "base64", data: "not base64!" },
      { type: "unknown", value: "x" },
    ]
  ) {
    const error = captureAppError(() =>
      parseCreateGeneration({
        ...common,
        prompt: "Long enough cover prompt",
        source,
      })
    );
    assert.equal(error.status, 422);
    assert.ok(
      error.fields && Object.keys(error.fields).some((field) => field.startsWith("source")),
    );
  }
});

Deno.test("lyric and cover preprocess parsers support every mode and source", () => {
  assert.deepEqual(parseGenerateLyrics({ mode: "write_full_song" }), {
    mode: "write_full_song",
  });
  assert.deepEqual(
    parseGenerateLyrics({
      mode: "edit",
      prompt: "Continue the bridge",
      lyrics: "Existing lyrics",
      title: "Fixed title",
    }),
    {
      mode: "edit",
      prompt: "Continue the bridge",
      lyrics: "Existing lyrics",
      title: "Fixed title",
    },
  );
  assert.deepEqual(
    parseCoverPreprocess({
      source: { type: "url", url: "https://audio.example/song.wav" },
    }),
    { source: { type: "url", url: "https://audio.example/song.wav" } },
  );
  assert.deepEqual(parseCoverPreprocess({ source: { type: "base64", data: "UklGRg==" } }), {
    source: { type: "base64", data: "UklGRg==" },
  });

  const invalidLyrics = captureAppError(() => parseGenerateLyrics({ mode: "unknown", extra: 1 }));
  assert.equal(invalidLyrics.message, "Check the lyric generation settings.");
  const invalidCover = captureAppError(() =>
    parseCoverPreprocess({ source: { type: "feature", featureId: "not-allowed" } })
  );
  assert.equal(invalidCover.message, "Check the cover reference audio.");
});

Deno.test("parseListFilters supplies defaults and parses valid filters", () => {
  assert.deepEqual(parseListFilters(new URL("http://test/api/generations")), {
    query: "",
    status: undefined,
    limit: 50,
    offset: 0,
  });
  assert.deepEqual(
    parseListFilters(
      new URL(
        "http://test/api/generations?q=%20neon%20&status=failed&limit=100&offset=100000",
      ),
    ),
    { query: "neon", status: "failed", limit: 100, offset: 100_000 },
  );
});

Deno.test("parseListFilters rejects invalid search, status, limits, and offsets", () => {
  assert.equal(
    captureAppError(() => parseListFilters(new URL(`http://test/?q=${"x".repeat(201)}`))).message,
    "Search is too long.",
  );
  assert.equal(
    captureAppError(() => parseListFilters(new URL("http://test/?status=unknown"))).message,
    "Unknown generation status.",
  );
  for (const limit of ["0", "101", "1.5", "nan"]) {
    assert.equal(
      captureAppError(() => parseListFilters(new URL(`http://test/?limit=${limit}`))).message,
      "Limit must be between 1 and 100.",
    );
  }
  for (const offset of ["-1", "100001", "1.5", "nan"]) {
    assert.equal(
      captureAppError(() => parseListFilters(new URL(`http://test/?offset=${offset}`))).message,
      "Offset must be between 0 and 100000.",
    );
  }
});

Deno.test("parseTitle trims valid text and rejects malformed bodies", () => {
  assert.equal(parseTitle({ title: "  A cleaner title  " }), "A cleaner title");
  for (
    const value of [
      { title: "" },
      { title: "x".repeat(81) },
      { title: 42 },
      { title: "Valid", extra: true },
    ]
  ) {
    const error = captureAppError(() => parseTitle(value));
    assert.equal(error.status, 422);
    assert.equal(error.code, "validation_error");
    assert.ok(error.fields);
  }
});

Deno.test("validateTenantId accepts bounded safe identifiers and rejects unsafe ones", () => {
  assert.equal(validateTenantId("a"), "a");
  const longest = `a${"_-Z9".repeat(15)}xyz`;
  assert.equal(longest.length, 64);
  assert.equal(validateTenantId(longest), longest);
  for (
    const value of [
      "",
      "-leading",
      "space tenant",
      "../escape",
      `a${"b".repeat(64)}`,
    ]
  ) {
    const error = captureAppError(() => validateTenantId(value));
    assert.equal(error.status, 400);
    assert.equal(error.code, "invalid_tenant");
  }
});
