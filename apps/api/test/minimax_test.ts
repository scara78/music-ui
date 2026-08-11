import assert from "node:assert/strict";
import type { AudioFormat } from "@contracts/index.ts";
import { type Fetcher, MiniMaxClient, type MiniMaxClientOptions } from "../src/minimax.ts";
import { captureProviderError, makeInput } from "./fixtures.ts";

const MP3_ID3 = new Uint8Array([0x49, 0x44, 0x33, 0x04]);
const MP3_FRAME = new Uint8Array([0xff, 0xe3, 0x01]);
const WAV = new Uint8Array([
  0x52,
  0x49,
  0x46,
  0x46,
  0,
  0,
  0,
  0,
  0x57,
  0x41,
  0x56,
  0x45,
]);
const PCM = new Uint8Array([1]);

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function audioResponse(
  bytes: Uint8Array,
  headers: HeadersInit = {},
  status = 200,
): Response {
  return new Response(Uint8Array.from(bytes).buffer, { status, headers });
}

function completed(audio: string, extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    data: { status: 2, audio },
    base_resp: { status_code: 0, status_msg: "success" },
    ...extras,
  };
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fetchResponse(
  handler: (input: string | URL | Request, init?: RequestInit) => Response,
): Fetcher {
  return (input, init) => Promise.resolve(handler(input, init));
}

function sequenceFetcher(
  steps: Array<Response | Error>,
  calls: Array<{ url: string; init: RequestInit | undefined }> = [],
): Fetcher {
  let index = 0;
  return (input, init) => {
    calls.push({ url: String(input), init });
    const step = steps[index++];
    if (!step) return Promise.reject(new Error("Unexpected fetch"));
    return step instanceof Error ? Promise.reject(step) : Promise.resolve(step);
  };
}

function urlClient(
  download: Response | Error,
  options: MiniMaxClientOptions = {},
  extras: Record<string, unknown> = {},
): MiniMaxClient {
  return new MiniMaxClient(
    "key",
    "https://api.example",
    sequenceFetcher([
      jsonResponse(completed("https://cdn.example/audio.mp3", extras)),
      download,
    ]),
    options,
  );
}

Deno.test("MiniMaxClient requires an API key before making a request", async () => {
  let fetched = false;
  const client = new MiniMaxClient(
    "",
    "https://api.example",
    fetchResponse(() => {
      fetched = true;
      return jsonResponse({});
    }),
  );
  const error = await captureProviderError(() => client.generate(makeInput()));
  assert.equal(error.code, "missing_api_key");
  assert.equal(fetched, false);
});

Deno.test("MiniMaxClient serializes documented fields, uses a timeout, and decodes WAV hex", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const fetcher: Fetcher = (input, init) => {
    requestedUrl = String(input);
    requestedInit = init;
    return Promise.resolve(jsonResponse(completed(hex(WAV), {
      trace_id: "trace-123",
      extra_info: { music_duration: 4567 },
    })));
  };
  const client = new MiniMaxClient("test-key", "https://api.example", fetcher, {
    generationTimeoutMs: 1234,
    downloadTimeoutMs: 2345,
    maxAudioBytes: 1024,
    downloadAttempts: 3,
  });
  const input = makeInput({
    model: "music-3.0",
    lyricsOptimizer: false,
    instrumental: false,
    audio: { sampleRate: 16000, bitrate: 32000, format: "wav" },
  });
  const result = await client.generate(input);

  assert.equal(requestedUrl, "https://api.example/v1/music_generation");
  assert.equal(requestedInit?.method, "POST");
  assert.ok(requestedInit?.signal instanceof AbortSignal);
  assert.deepEqual(requestedInit?.headers, {
    authorization: "Bearer test-key",
    "content-type": "application/json",
  });
  assert.deepEqual(JSON.parse(String(requestedInit?.body)), {
    model: "music-3.0",
    prompt: input.prompt,
    lyrics: input.lyrics,
    lyrics_optimizer: false,
    is_instrumental: false,
    stream: false,
    output_format: "url",
    audio_setting: { sample_rate: 16000, bitrate: 32000, format: "wav" },
  });
  assert.deepEqual(result.bytes, WAV);
  assert.equal(result.durationMs, 4567);
  assert.equal(result.traceId, "trace-123");
});

Deno.test("MiniMaxClient omits empty lyrics and defaults optional response metadata", async () => {
  let body: Record<string, unknown> | undefined;
  const client = new MiniMaxClient(
    "key",
    "https://api.example",
    fetchResponse((_input, init) => {
      body = JSON.parse(String(init?.body));
      return jsonResponse(completed(hex(MP3_ID3)));
    }),
  );
  const result = await client.generate(makeInput({
    prompt: "A quiet instrumental",
    lyrics: "",
    instrumental: true,
  }));
  assert.equal(Object.hasOwn(body ?? {}, "lyrics"), false);
  assert.deepEqual(result.bytes, MP3_ID3);
  assert.equal(result.durationMs, null);
  assert.equal(result.traceId, null);
});

Deno.test("MiniMaxClient accepts PCM and MPEG frame magic in inline audio", async () => {
  for (
    const fixture of [
      { format: "pcm" as const, bytes: PCM },
      { format: "mp3" as const, bytes: MP3_FRAME },
    ]
  ) {
    const client = new MiniMaxClient(
      "key",
      "https://api.example",
      fetchResponse(() => jsonResponse(completed(hex(fixture.bytes)))),
    );
    const result = await client.generate(makeInput({ audio: { format: fixture.format } }));
    assert.deepEqual(result.bytes, fixture.bytes);
  }
});

Deno.test("MiniMaxClient requires an explicit successful provider status", async () => {
  const client = new MiniMaxClient(
    "key",
    "https://api.example",
    fetchResponse(() =>
      jsonResponse({ data: { status: 2, audio: hex(MP3_ID3) }, trace_id: "strict-trace" })
    ),
  );
  const error = await captureProviderError(() => client.generate(makeInput()));
  assert.equal(error.code, "invalid_response");
  assert.equal(error.traceId, "strict-trace");

  const withoutTrace = new MiniMaxClient(
    "key",
    "https://api.example",
    fetchResponse(() => jsonResponse({ data: { status: 2, audio: hex(MP3_ID3) } })),
  );
  const untracedError = await captureProviderError(() => withoutTrace.generate(makeInput()));
  assert.equal(untracedError.code, "invalid_response");
  assert.equal(untracedError.traceId, null);
});

Deno.test("MiniMaxClient maps provider status codes, messages, and traces", async () => {
  const payloads = [
    {
      body: { base_resp: { status_code: 1002, status_msg: "raw" }, trace_id: "limited" },
      code: "1002",
      message: "The MiniMax rate limit was reached. Try again in a moment.",
      traceId: "limited",
    },
    {
      body: { base_resp: { status_code: 9998, status_msg: "Provider-specific explanation" } },
      code: "9998",
      message: "Provider-specific explanation",
      traceId: null,
    },
    {
      body: { base_resp: { status_code: 9999 } },
      code: "9999",
      message: "MiniMax rejected the request.",
      traceId: null,
    },
  ];
  for (const item of payloads) {
    const client = new MiniMaxClient(
      "key",
      "https://api.example",
      fetchResponse(() => jsonResponse(item.body)),
    );
    const error = await captureProviderError(() => client.generate(makeInput()));
    assert.equal(error.code, item.code);
    assert.equal(error.message, item.message);
    assert.equal(error.traceId, item.traceId);
  }
});

Deno.test("MiniMaxClient requires completed status and returned audio with trace propagation", async () => {
  for (
    const fixture of [
      {
        body: {
          data: { status: 1, audio: hex(MP3_ID3) },
          base_resp: { status_code: 0 },
          trace_id: "incomplete",
        },
        code: "incomplete_generation",
      },
      {
        body: { data: { audio: hex(MP3_ID3) }, base_resp: { status_code: 0 } },
        code: "incomplete_generation",
      },
      {
        body: { data: { status: 2 }, base_resp: { status_code: 0 }, trace_id: "missing" },
        code: "missing_audio",
      },
    ]
  ) {
    const client = new MiniMaxClient(
      "key",
      "https://api.example",
      fetchResponse(() => jsonResponse(fixture.body)),
    );
    const error = await captureProviderError(() => client.generate(makeInput()));
    assert.equal(error.code, fixture.code);
    assert.equal(error.traceId, "trace_id" in fixture.body ? fixture.body.trace_id : null);
  }
});

Deno.test("MiniMaxClient rejects malformed, oversized, and wrongly encoded inline audio", async () => {
  const cases: Array<{
    audio: string;
    format?: AudioFormat;
    options?: MiniMaxClientOptions;
    trace?: string;
    code: string;
  }> = [
    { audio: "", code: "missing_audio" },
    { audio: "ABC", code: "invalid_audio", trace: "decode-trace" },
    { audio: "GG", code: "invalid_audio" },
    { audio: "49", code: "invalid_audio" },
    { audio: "000102", code: "invalid_audio" },
    { audio: "ff0102", code: "invalid_audio" },
    { audio: hex(WAV.slice(0, 11)), format: "wav", code: "invalid_audio" },
    { audio: hex(new Uint8Array([...WAV]).fill(0x00, 0, 4)), format: "wav", code: "invalid_audio" },
    {
      audio: hex(new Uint8Array([...WAV]).fill(0x00, 8, 12)),
      format: "wav",
      code: "invalid_audio",
    },
    { audio: hex(MP3_ID3), options: { maxAudioBytes: 3 }, code: "audio_too_large" },
  ];

  for (const fixture of cases) {
    const client = new MiniMaxClient(
      "key",
      "https://api.example",
      fetchResponse(() =>
        jsonResponse(completed(fixture.audio, fixture.trace ? { trace_id: fixture.trace } : {}))
      ),
      fixture.options,
    );
    const error = await captureProviderError(() =>
      client.generate(makeInput({ audio: { format: fixture.format ?? "mp3" } }))
    );
    assert.equal(error.code, fixture.code);
    assert.equal(error.traceId, fixture.trace ?? null);
  }
});

Deno.test("MiniMaxClient handles HTTP, JSON, timeout, abort, and transport generation failures without retry", async () => {
  const httpCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const http = new MiniMaxClient(
    "key",
    "https://api.example",
    sequenceFetcher([new Response("not-json", { status: 502 })], httpCalls),
  );
  assert.equal((await captureProviderError(() => http.generate(makeInput()))).code, "http_502");
  assert.equal(httpCalls.length, 1);

  const invalid = new MiniMaxClient(
    "key",
    "https://api.example",
    sequenceFetcher([new Response("not-json")]),
  );
  assert.equal(
    (await captureProviderError(() => invalid.generate(makeInput()))).code,
    "invalid_response",
  );

  for (const name of ["TimeoutError", "AbortError"]) {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new MiniMaxClient(
      "key",
      "https://api.example",
      sequenceFetcher([new DOMException("slow", name)], calls),
    );
    assert.equal(
      (await captureProviderError(() => client.generate(makeInput()))).code,
      "generation_timeout",
    );
    assert.equal(calls.length, 1);
  }

  const transport = new Error("network unavailable");
  const raw = new MiniMaxClient(
    "key",
    "https://api.example",
    sequenceFetcher([transport]),
  );
  await assert.rejects(() => raw.generate(makeInput()), (error) => error === transport);
});

Deno.test("MiniMaxClient prefers audio_url and falls back to a URL in audio", async () => {
  const preferredCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const preferred = new MiniMaxClient(
    "key",
    "https://api.example",
    sequenceFetcher([
      jsonResponse({
        data: {
          status: 2,
          audio: "https://ignored.example/audio.mp3",
          audio_url: "https://cdn.example/preferred.mp3",
        },
        base_resp: { status_code: 0 },
      }),
      audioResponse(MP3_ID3, { "content-type": "audio/mpeg" }),
    ], preferredCalls),
  );
  assert.deepEqual((await preferred.generate(makeInput())).bytes, MP3_ID3);
  assert.deepEqual(preferredCalls.map((call) => call.url), [
    "https://api.example/v1/music_generation",
    "https://cdn.example/preferred.mp3",
  ]);
  assert.ok(preferredCalls[1]?.init?.signal instanceof AbortSignal);

  const fallback = new MiniMaxClient(
    "key",
    "https://api.example",
    sequenceFetcher([
      jsonResponse(completed("http://cdn.example/fallback.pcm")),
      audioResponse(PCM, { "content-type": "application/octet-stream" }),
    ]),
  );
  assert.deepEqual(
    (await fallback.generate(makeInput({ audio: { format: "pcm" } }))).bytes,
    PCM,
  );
});

Deno.test("MiniMaxClient retries only rejected and 5xx audio downloads", async () => {
  for (
    const firstFailure of [
      new Error("connection reset"),
      new Response("temporary", { status: 503 }),
    ]
  ) {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new MiniMaxClient(
      "key",
      "https://api.example",
      sequenceFetcher([
        jsonResponse(completed("https://cdn.example/retry.mp3")),
        firstFailure,
        audioResponse(MP3_ID3, { "content-type": "audio/mpeg" }),
      ], calls),
    );
    assert.deepEqual((await client.generate(makeInput())).bytes, MP3_ID3);
    assert.equal(calls.length, 3);
  }

  const notFoundCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const notFound = new MiniMaxClient(
    "key",
    "https://api.example",
    sequenceFetcher([
      jsonResponse(completed("https://cdn.example/missing.mp3")),
      new Response("missing", { status: 404 }),
      audioResponse(MP3_ID3),
    ], notFoundCalls),
  );
  assert.equal(
    (await captureProviderError(() => notFound.generate(makeInput()))).code,
    "audio_download_failed",
  );
  assert.equal(notFoundCalls.length, 2);
});

Deno.test("MiniMaxClient classifies final download failures and zero attempts", async () => {
  const cases: Array<{
    failure: Error | Response;
    code: string;
  }> = [
    { failure: new Response("still down", { status: 500 }), code: "audio_download_failed" },
    { failure: new Error("socket closed"), code: "audio_download_failed" },
    { failure: new DOMException("slow", "TimeoutError"), code: "audio_download_timeout" },
  ];
  for (const fixture of cases) {
    const client = urlClient(fixture.failure, { downloadAttempts: 1 });
    assert.equal(
      (await captureProviderError(() => client.generate(makeInput()))).code,
      fixture.code,
    );
  }

  const zero = new MiniMaxClient(
    "key",
    "https://api.example",
    sequenceFetcher([jsonResponse(completed("https://cdn.example/audio.mp3"))]),
    { downloadAttempts: 0 },
  );
  assert.equal(
    (await captureProviderError(() => zero.generate(makeInput()))).code,
    "audio_download_failed",
  );
});

Deno.test("MiniMaxClient validates download MIME types and content-length forms", async () => {
  const headerSets: HeadersInit[] = [
    {},
    { "content-type": " AUDIO/MPEG ; charset=binary", "content-length": "n/a" },
    { "content-type": "application/octet-stream", "content-length": "4" },
    { "content-type": "binary/octet-stream" },
  ];
  for (const headers of headerSets) {
    assert.deepEqual(
      (await urlClient(audioResponse(MP3_ID3, headers)).generate(makeInput())).bytes,
      MP3_ID3,
    );
  }

  const invalidType = await captureProviderError(() =>
    urlClient(
      audioResponse(MP3_ID3, { "content-type": "text/html" }),
      {},
      { trace_id: "type-trace" },
    ).generate(makeInput())
  );
  assert.equal(invalidType.code, "invalid_audio_type");
  assert.equal(invalidType.traceId, "type-trace");
});

Deno.test("MiniMaxClient enforces pre-read and post-read size caps", async () => {
  const declared = urlClient(
    audioResponse(MP3_ID3, { "content-length": "4" }),
    { maxAudioBytes: 3 },
  );
  assert.equal(
    (await captureProviderError(() => declared.generate(makeInput()))).code,
    "audio_too_large",
  );

  const actual = urlClient(audioResponse(MP3_ID3), { maxAudioBytes: 3 });
  assert.equal(
    (await captureProviderError(() => actual.generate(makeInput()))).code,
    "audio_too_large",
  );
});

Deno.test("MiniMaxClient rejects empty and invalid downloaded audio", async () => {
  assert.equal(
    (await captureProviderError(() =>
      urlClient(audioResponse(new Uint8Array())).generate(makeInput())
    )).code,
    "empty_audio",
  );
  assert.equal(
    (await captureProviderError(() =>
      urlClient(audioResponse(new Uint8Array([1, 2, 3]))).generate(makeInput())
    )).code,
    "invalid_audio",
  );
});

Deno.test("MiniMaxClient preserves unexpected audio body read failures", async () => {
  const bodyError = new Error("body stream broke");
  const response = audioResponse(MP3_ID3);
  Object.defineProperty(response, "arrayBuffer", {
    value: () => Promise.reject(bodyError),
  });
  const client = urlClient(response, {}, { trace_id: "provider-trace" });
  await assert.rejects(() => client.generate(makeInput()), (error) => error === bodyError);
});

Deno.test("MiniMaxClient serializes every one-step and two-step cover source", async () => {
  const fixtures = [
    {
      source: { type: "url" as const, url: "https://audio.example/original.mp3" },
      expected: { audio_url: "https://audio.example/original.mp3" },
      lyrics: undefined,
    },
    {
      source: { type: "base64" as const, data: "SUQz" },
      expected: { audio_base64: "SUQz" },
      lyrics: "Replacement cover lyrics",
    },
    {
      source: { type: "feature" as const, featureId: "feature-id" },
      expected: { cover_feature_id: "feature-id" },
      lyrics: "Edited two-step lyrics",
    },
  ];
  for (const fixture of fixtures) {
    let body: Record<string, unknown> = {};
    const client = new MiniMaxClient(
      "key",
      "https://api.example",
      fetchResponse((_input, init) => {
        body = JSON.parse(String(init?.body));
        return jsonResponse(completed(hex(MP3_ID3)));
      }),
    );
    await client.generate({
      model: "music-cover-free",
      prompt: "Smooth late-night jazz cover",
      lyrics: fixture.lyrics,
      source: fixture.source,
      audio: { sampleRate: 44100, bitrate: 256000, format: "mp3" },
    });
    assert.deepEqual(body, {
      model: "music-cover-free",
      prompt: "Smooth late-night jazz cover",
      ...(fixture.lyrics ? { lyrics: fixture.lyrics } : {}),
      stream: false,
      output_format: "url",
      audio_setting: { sample_rate: 44100, bitrate: 256000, format: "mp3" },
      ...fixture.expected,
    });
    assert.equal(Object.hasOwn(body, "lyrics_optimizer"), false);
    assert.equal(Object.hasOwn(body, "is_instrumental"), false);
  }
});

Deno.test("MiniMaxClient generates and edits lyrics with every optional field", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const client = new MiniMaxClient(
    "key",
    "https://api.example",
    sequenceFetcher([
      jsonResponse({
        song_title: "Kept title",
        style_tags: "Pop, Bright",
        lyrics: "[Verse]\nGenerated words",
        base_resp: { status_code: 0 },
      }),
      jsonResponse({
        song_title: "Random title",
        style_tags: "Ambient",
        lyrics: "[Intro]\nRandom words",
        base_resp: { status_code: 0 },
      }),
    ], calls),
    { generationTimeoutMs: 4321 },
  );
  assert.deepEqual(
    await client.generateLyrics({
      mode: "edit",
      prompt: "Continue the bridge",
      lyrics: "Existing words",
      title: "Kept title",
    }),
    {
      songTitle: "Kept title",
      styleTags: "Pop, Bright",
      lyrics: "[Verse]\nGenerated words",
    },
  );
  assert.deepEqual(await client.generateLyrics({ mode: "write_full_song" }), {
    songTitle: "Random title",
    styleTags: "Ambient",
    lyrics: "[Intro]\nRandom words",
  });
  assert.equal(calls[0]?.url, "https://api.example/v1/lyrics_generation");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    mode: "edit",
    prompt: "Continue the bridge",
    lyrics: "Existing words",
    title: "Kept title",
  });
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), { mode: "write_full_song" });
  assert.ok(calls[0]?.init?.signal instanceof AbortSignal);
});

Deno.test("MiniMaxClient preprocesses URL and base64 cover references", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const response = {
    cover_feature_id: "feature-id",
    formatted_lyrics: "[Verse]\nWords",
    structure_result: '{"num_segments":1}',
    audio_duration: 91.5,
    base_resp: { status_code: 0 },
  };
  const client = new MiniMaxClient(
    "key",
    "https://api.example",
    sequenceFetcher([
      jsonResponse({ ...response, trace_id: "trace-id" }),
      jsonResponse(response),
    ], calls),
  );
  assert.deepEqual(
    await client.preprocessCover({
      source: { type: "url", url: "https://audio.example/song.wav" },
    }),
    {
      coverFeatureId: "feature-id",
      formattedLyrics: "[Verse]\nWords",
      structureResult: '{"num_segments":1}',
      audioDuration: 91.5,
      traceId: "trace-id",
    },
  );
  assert.equal(
    (await client.preprocessCover({
      source: { type: "base64", data: "UklGRg==" },
    })).traceId,
    null,
  );
  assert.equal(calls[0]?.url, "https://api.example/v1/music_cover_preprocess");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    model: "music-cover",
    audio_url: "https://audio.example/song.wav",
  });
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), {
    model: "music-cover",
    audio_base64: "UklGRg==",
  });
});

Deno.test("MiniMaxClient validates lyric and cover utility responses", async () => {
  const validLyrics = {
    song_title: "Title",
    style_tags: "Pop",
    lyrics: "Words",
    base_resp: { status_code: 0 },
  };
  for (const missing of ["song_title", "style_tags", "lyrics"] as const) {
    const payload = { ...validLyrics };
    delete payload[missing];
    const client = new MiniMaxClient(
      "key",
      "https://api.example",
      fetchResponse(() => jsonResponse(payload)),
    );
    assert.equal(
      (await captureProviderError(() => client.generateLyrics({ mode: "write_full_song" }))).code,
      "invalid_response",
    );
  }

  const validCover = {
    cover_feature_id: "feature",
    formatted_lyrics: "Words",
    structure_result: "{}",
    audio_duration: 90,
    trace_id: "trace",
    base_resp: { status_code: 0 },
  };
  for (
    const missing of [
      "cover_feature_id",
      "formatted_lyrics",
      "structure_result",
      "audio_duration",
    ] as const
  ) {
    const payload = { ...validCover };
    delete payload[missing];
    const client = new MiniMaxClient(
      "key",
      "https://api.example",
      fetchResponse(() => jsonResponse(payload)),
    );
    const error = await captureProviderError(() =>
      client.preprocessCover({ source: { type: "base64", data: "SUQz" } })
    );
    assert.equal(error.code, "invalid_response");
    assert.equal(error.traceId, "trace");
  }

  const untraced = new MiniMaxClient(
    "key",
    "https://api.example",
    fetchResponse(() => jsonResponse({ base_resp: { status_code: 0 } })),
  );
  assert.equal(
    (await captureProviderError(() =>
      untraced.preprocessCover({ source: { type: "base64", data: "SUQz" } })
    )).traceId,
    null,
  );
});

Deno.test("MiniMaxClient safely classifies lyric and preprocess request failures", async () => {
  const noKey = new MiniMaxClient("", "https://api.example", sequenceFetcher([]));
  assert.equal(
    (await captureProviderError(() => noKey.generateLyrics({ mode: "write_full_song" }))).code,
    "missing_api_key",
  );

  for (
    const fixture of [
      {
        failure: new DOMException("slow", "TimeoutError"),
        method: "lyrics" as const,
        code: "lyrics_timeout",
      },
      {
        failure: new DOMException("aborted", "AbortError"),
        method: "cover" as const,
        code: "cover_preprocess_timeout",
      },
      {
        failure: new Error("secret socket detail"),
        method: "lyrics" as const,
        code: "transport_error",
      },
      { failure: jsonResponse({}, 503), method: "cover" as const, code: "http_503" },
      { failure: new Response("not json"), method: "lyrics" as const, code: "invalid_response" },
    ]
  ) {
    const client = new MiniMaxClient(
      "key",
      "https://api.example",
      sequenceFetcher([fixture.failure]),
    );
    const error = await captureProviderError(() =>
      fixture.method === "lyrics"
        ? client.generateLyrics({ mode: "write_full_song" })
        : client.preprocessCover({ source: { type: "base64", data: "SUQz" } })
    );
    assert.equal(error.code, fixture.code);
  }
});

Deno.test("MiniMaxClient requires utility base status and maps provider failures", async () => {
  const payloads = [
    { song_title: "x", style_tags: "x", lyrics: "x" },
    { base_resp: { status_code: 1002 } },
    { base_resp: { status_code: 9999, status_msg: "Provider detail" } },
    { base_resp: { status_code: 9998 } },
  ];
  const expected = [
    ["invalid_response", "MiniMax omitted its response status."],
    ["1002", "The MiniMax rate limit was reached. Try again in a moment."],
    ["9999", "Provider detail"],
    ["9998", "MiniMax rejected the request."],
  ];
  for (let index = 0; index < payloads.length; index += 1) {
    const client = new MiniMaxClient(
      "key",
      "https://api.example",
      fetchResponse(() => jsonResponse(payloads[index])),
    );
    const error = await captureProviderError(() =>
      client.generateLyrics({ mode: "write_full_song" })
    );
    assert.deepEqual([error.code, error.message], expected[index]);
  }

  const traced = new MiniMaxClient(
    "key",
    "https://api.example",
    fetchResponse(() => jsonResponse({ trace_id: "trace", base_resp: { status_code: 2013 } })),
  );
  assert.equal(
    (await captureProviderError(() =>
      traced.preprocessCover({ source: { type: "base64", data: "SUQz" } })
    )).traceId,
    "trace",
  );
});
