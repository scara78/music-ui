import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { GenerationRepository, openMemoryRepository, openRepository } from "../src/repository.ts";
import { LATER, makeInput, NOW } from "./fixtures.ts";

Deno.test("GenerationRepository creates complete records with explicit and fallback metadata", () => {
  const repository = openMemoryRepository();
  try {
    const explicit = repository.create("tenant-a", makeInput(), NOW, "explicit-id");
    assert.deepEqual(explicit, {
      id: "explicit-id",
      tenantId: "tenant-a",
      kind: "track",
      title: "Midnight Current",
      model: "music-3.0-free",
      prompt: "Dreamy synthwave with a patient build",
      lyrics: "[Verse]\nNeon on the water",
      lyricsOptimizer: false,
      instrumental: false,
      audio: { sampleRate: 44100, bitrate: 256000, format: "mp3" },
      status: "queued",
      audioPath: null,
      audioMimeType: null,
      durationMs: null,
      sizeBytes: null,
      sha256: null,
      traceId: null,
      errorCode: null,
      errorMessage: null,
      createdAt: NOW,
      updatedAt: NOW,
      completedAt: null,
      retryOfId: null,
      coverSource: null,
      audioUrl: null,
    });

    const fallback = repository.create(
      "tenant-a",
      makeInput({ title: undefined, prompt: "  Ocean lights, slow drums" }),
      NOW,
      "fallback-id",
    );
    assert.equal(fallback.title, "Ocean lights");

    const untitled = repository.create(
      "tenant-a",
      makeInput({ title: undefined, prompt: "" }),
      NOW,
      "untitled-id",
    );
    assert.equal(untitled.title, "Untitled track");

    const generatedId = repository.create("tenant-a", makeInput(), NOW).id;
    assert.match(generatedId, /^[0-9a-f-]{36}$/);

    const optimized = repository.create(
      "tenant-a",
      makeInput({ lyricsOptimizer: true }),
      NOW,
      "optimized-id",
    );
    assert.equal(optimized.lyricsOptimizer, true);
  } finally {
    repository.close();
  }
});

Deno.test("GenerationRepository scopes get, update, and list operations by tenant", () => {
  const repository = openMemoryRepository();
  try {
    repository.create("tenant-a", makeInput({ title: "Alpha song" }), NOW, "alpha");
    repository.create("tenant-b", makeInput({ title: "Beta song" }), NOW, "beta");

    assert.equal(repository.getById("tenant-a", "alpha")?.title, "Alpha song");
    assert.equal(repository.getById("tenant-b", "alpha"), null);
    assert.equal(repository.getById("tenant-a", "missing"), null);
    assert.deepEqual(
      repository.list("tenant-a", { query: "", limit: 50, offset: 0 }).items.map((item) => item.id),
      ["alpha"],
    );
    assert.deepEqual(
      repository.list("tenant-b", { query: "", limit: 50, offset: 0 }).items.map((item) => item.id),
      ["beta"],
    );

    assert.equal(repository.updateTitle("tenant-b", "alpha", "Leaked", LATER), null);
    assert.equal(repository.getById("tenant-a", "alpha")?.title, "Alpha song");
    assert.equal(repository.updateTitle("tenant-a", "alpha", "Renamed", LATER)?.title, "Renamed");
    assert.equal(repository.getById("tenant-a", "alpha")?.updatedAt, LATER);
  } finally {
    repository.close();
  }
});

Deno.test("GenerationRepository filters literal search characters, prompts, status, limit, and total", () => {
  const repository = openMemoryRepository();
  try {
    repository.create("tenant", makeInput({ title: "100% Real" }), NOW, "percent");
    repository.create("tenant", makeInput({ title: "1000 Real" }), NOW, "plain");
    repository.create("tenant", makeInput({ title: "under_score" }), NOW, "underscore");
    repository.create("tenant", makeInput({ title: "back\\slash" }), NOW, "backslash");
    repository.create(
      "tenant",
      makeInput({ title: "Different", prompt: "A luminous cobalt horizon" }),
      LATER,
      "prompt-match",
    );
    repository.create(
      "tenant",
      makeInput({ title: "Another", prompt: "Unrelated", lyrics: "[Verse]\nSilver thunder" }),
      LATER,
      "lyrics-match",
    );
    repository.markFailed("tenant", "plain", "failed", "failure", LATER);

    assert.deepEqual(
      repository.list("tenant", { query: "%", limit: 50, offset: 0 }).items.map((item) => item.id),
      ["percent"],
    );
    assert.deepEqual(
      repository.list("tenant", { query: "_", limit: 50, offset: 0 }).items.map((item) => item.id),
      ["underscore"],
    );
    assert.deepEqual(
      repository.list("tenant", { query: "\\", limit: 50, offset: 0 }).items.map((item) => item.id),
      ["backslash"],
    );
    assert.deepEqual(
      repository.list("tenant", { query: "COBALT", limit: 50, offset: 0 }).items.map((item) =>
        item.id
      ),
      ["prompt-match"],
    );
    assert.deepEqual(
      repository.list("tenant", { query: "THUNDER", limit: 50, offset: 0 }).items.map((item) =>
        item.id
      ),
      ["lyrics-match"],
    );
    assert.deepEqual(
      repository.list("tenant", { query: "", status: "failed", limit: 50, offset: 0 }).items.map((
        item,
      ) => item.id),
      ["plain"],
    );

    const limited = repository.list("tenant", { query: "", limit: 2, offset: 0 });
    assert.equal(limited.items.length, 2);
    assert.equal(limited.total, 6);
    assert.deepEqual(limited.items.map((item) => item.id), ["prompt-match", "lyrics-match"]);
  } finally {
    repository.close();
  }
});

Deno.test("GenerationRepository orders equal timestamps by descending ID", () => {
  const repository = openMemoryRepository();
  try {
    repository.create("tenant", makeInput(), NOW, "a-id");
    repository.create("tenant", makeInput(), NOW, "z-id");
    assert.deepEqual(
      repository.list("tenant", { query: "", limit: 50, offset: 0 }).items.map((item) => item.id),
      ["z-id", "a-id"],
    );
  } finally {
    repository.close();
  }
});

Deno.test("GenerationRepository paginates within tenant, status, and search filters while retaining total", () => {
  const repository = openMemoryRepository();
  try {
    repository.create(
      "tenant-a",
      makeInput({ title: "Paged constellation one" }),
      NOW,
      "match-one",
    );
    repository.create(
      "tenant-a",
      makeInput({ title: "Paged constellation two" }),
      LATER,
      "match-two",
    );
    repository.create(
      "tenant-a",
      makeInput({ title: "Paged constellation queued" }),
      LATER,
      "queued-match",
    );
    repository.create(
      "tenant-b",
      makeInput({ title: "Paged constellation other tenant" }),
      LATER,
      "other-tenant-match",
    );
    repository.markFailed("tenant-a", "match-one", "failed", "failed", LATER);
    repository.markFailed("tenant-a", "match-two", "failed", "failed", LATER);
    repository.markFailed("tenant-b", "other-tenant-match", "failed", "failed", LATER);

    const firstPage = repository.list("tenant-a", {
      query: "CONSTELLATION",
      status: "failed",
      limit: 1,
      offset: 0,
    });
    assert.deepEqual(firstPage.items.map((item) => item.id), ["match-two"]);
    assert.equal(firstPage.total, 2);

    const secondPage = repository.list("tenant-a", {
      query: "CONSTELLATION",
      status: "failed",
      limit: 1,
      offset: 1,
    });
    assert.deepEqual(secondPage.items.map((item) => item.id), ["match-one"]);
    assert.equal(secondPage.total, 2);

    const pastEnd = repository.list("tenant-a", {
      query: "CONSTELLATION",
      status: "failed",
      limit: 1,
      offset: 2,
    });
    assert.deepEqual(pastEnd.items, []);
    assert.equal(pastEnd.total, 2);
  } finally {
    repository.close();
  }
});

Deno.test("GenerationRepository records generating, failed, reset, and completed transitions", () => {
  const repository = openMemoryRepository();
  try {
    repository.create(
      "tenant",
      makeInput({ instrumental: true, lyrics: "", lyricsOptimizer: false }),
      NOW,
      "track",
    );
    repository.markFailed("tenant", "track", "provider_failure", "Provider failed", LATER);
    let record = repository.getById("tenant", "track")!;
    assert.equal(record.status, "failed");
    assert.equal(record.errorCode, "provider_failure");
    assert.equal(record.errorMessage, "Provider failed");
    assert.equal(record.instrumental, true);

    const generatingAt = "2026-08-11T12:02:00.000Z";
    repository.markGenerating("tenant", "track", generatingAt);
    record = repository.getById("tenant", "track")!;
    assert.equal(record.status, "generating");
    assert.equal(record.errorCode, null);
    assert.equal(record.errorMessage, null);
    assert.equal(record.updatedAt, generatingAt);

    const completedAt = "2026-08-11T12:03:00.000Z";
    repository.markCompleted("tenant", "track", {
      audioPath: "/audio/track.mp3",
      audioMimeType: "audio/mpeg",
      durationMs: 1234,
      sizeBytes: 3,
      sha256: "abc123",
      traceId: "trace-id",
    }, completedAt);
    record = repository.getById("tenant", "track")!;
    assert.equal(record.status, "completed");
    assert.equal(record.audioPath, "/audio/track.mp3");
    assert.equal(record.audioMimeType, "audio/mpeg");
    assert.equal(record.durationMs, 1234);
    assert.equal(record.sizeBytes, 3);
    assert.equal(record.sha256, "abc123");
    assert.equal(record.traceId, "trace-id");
    assert.equal(record.completedAt, completedAt);
    assert.equal(record.audioUrl, "/api/generations/track/audio");

    repository.create("tenant", makeInput(), NOW, "null-metadata");
    repository.markCompleted("tenant", "null-metadata", {
      audioPath: "/audio/null.mp3",
      audioMimeType: "audio/mpeg",
      durationMs: null,
      sizeBytes: 0,
      sha256: "empty",
      traceId: null,
    }, completedAt);
    assert.equal(repository.getById("tenant", "null-metadata")?.durationMs, null);
    assert.equal(repository.getById("tenant", "null-metadata")?.traceId, null);

    repository.create("tenant", makeInput(), NOW, "failed-with-trace");
    repository.markFailed(
      "tenant",
      "failed-with-trace",
      "provider_error",
      "Provider failed",
      completedAt,
      "failure-trace",
    );
    assert.equal(repository.getById("tenant", "failed-with-trace")?.traceId, "failure-trace");
    repository.markFailed(
      "tenant",
      "failed-with-trace",
      "retry_error",
      "Retry failed",
      LATER,
    );
    assert.equal(repository.getById("tenant", "failed-with-trace")?.traceId, "failure-trace");
  } finally {
    repository.close();
  }
});

Deno.test("GenerationRepository exposes resumable rows and retry relationships", () => {
  const repository = openMemoryRepository();
  try {
    repository.create("tenant", makeInput(), NOW, "queued");
    repository.create("tenant", makeInput(), LATER, "generating");
    repository.markGenerating("tenant", "generating", LATER);
    repository.create("tenant", makeInput(), LATER, "failed");
    repository.markFailed("tenant", "failed", "x", "x", LATER);
    repository.create("tenant", makeInput(), LATER, "retry", "failed");

    assert.deepEqual(repository.listQueued().map((item) => item.id), ["queued", "retry"]);
    const interruptedAt = "2026-08-11T12:04:00.000Z";
    repository.markInterrupted(interruptedAt);
    const interrupted = repository.getById("tenant", "generating")!;
    assert.equal(interrupted.status, "failed");
    assert.equal(interrupted.errorCode, "interrupted");
    assert.equal(
      interrupted.errorMessage,
      "Generation was interrupted by an application restart. Retry it explicitly to avoid a duplicate song.",
    );
    assert.equal(interrupted.updatedAt, interruptedAt);
    assert.equal(repository.getById("tenant", "retry")?.retryOfId, "failed");
  } finally {
    repository.close();
  }
});

Deno.test("GenerationRepository durably stores every private cover source without loading it in lists", () => {
  const repository = openMemoryRepository();
  try {
    const common = {
      model: "music-cover-free" as const,
      prompt: "Smooth late-night jazz cover",
      audio: { sampleRate: 44100 as const, bitrate: 256000 as const, format: "mp3" as const },
    };
    repository.create(
      "tenant",
      {
        ...common,
        source: { type: "url", url: "https://audio.example/song.mp3" },
      },
      NOW,
      "url-cover",
    );
    const base64Created = repository.create(
      "tenant",
      {
        ...common,
        source: { type: "base64", data: "SUQz" },
        lyrics: "Replacement lyrics",
      },
      NOW,
      "base64-cover",
    );
    repository.create(
      "tenant",
      {
        ...common,
        model: "music-cover",
        source: { type: "feature", featureId: "feature-id" },
        lyrics: "Edited feature lyrics",
      },
      NOW,
      "feature-cover",
    );

    assert.equal(base64Created.coverSource, null);
    assert.equal(repository.getById("tenant", "url-cover")?.coverSource, null);
    assert.equal(repository.getById("tenant", "base64-cover")?.coverSource, null);
    assert.deepEqual(repository.getByIdWithSource("tenant", "url-cover")?.coverSource, {
      type: "url",
      url: "https://audio.example/song.mp3",
    });
    assert.deepEqual(repository.getByIdWithSource("tenant", "base64-cover")?.coverSource, {
      type: "base64",
      data: "SUQz",
    });
    const feature = repository.getByIdWithSource("tenant", "feature-cover")!;
    assert.equal(feature.kind, "cover");
    assert.equal(feature.model, "music-cover");
    assert.equal(feature.lyricsOptimizer, false);
    assert.equal(feature.instrumental, false);
    assert.deepEqual(feature.coverSource, { type: "feature", featureId: "feature-id" });

    const listed = repository.list("tenant", { query: "", limit: 50, offset: 0 });
    assert.equal(listed.items.length, 3);
    assert.ok(listed.items.every((item) => item.coverSource === null));
    assert.ok(repository.listQueued().every((item) => item.coverSource === null));
  } finally {
    repository.close();
  }
});

Deno.test("GenerationRepository deletes tenant rows and clears retry foreign keys", () => {
  const repository = openMemoryRepository();
  try {
    repository.create("tenant", makeInput({ title: "Original" }), NOW, "original");
    repository.create("tenant", makeInput({ title: "Retry" }), LATER, "retry", "original");
    assert.equal(repository.delete("other", "original"), null);
    assert.equal(repository.delete("tenant", "original")?.id, "original");
    assert.equal(repository.getById("tenant", "original"), null);
    assert.equal(repository.getById("tenant", "retry")?.retryOfId, null);
  } finally {
    repository.close();
  }
});

Deno.test("GenerationRepository versioned migration is repeatable and tolerates private columns", () => {
  const database = new DatabaseSync(":memory:");
  const repository = new GenerationRepository(database);
  try {
    repository.migrate();
    assert.equal(
      (database.prepare("PRAGMA user_version").get() as unknown as { user_version: number })
        .user_version,
      2,
    );
    database.exec("PRAGMA user_version = 1");
    repository.migrate();
    const names = (database.prepare("PRAGMA table_info(generations)").all() as unknown as Array<{
      name: string;
    }>).map((column) => column.name);
    assert.ok(names.includes("kind"));
    assert.ok(names.includes("cover_source_type"));
    assert.ok(names.includes("cover_source_value"));

    repository.create(
      "tenant",
      {
        model: "music-cover-free",
        prompt: "Smooth late-night jazz cover",
        source: { type: "url", url: "https://audio.example/song.mp3" },
        audio: { sampleRate: 44100, bitrate: 256000, format: "mp3" },
      },
      NOW,
      "invalid-source",
    );
    database.prepare(
      "UPDATE generations SET cover_source_type = 'unknown' WHERE id = 'invalid-source'",
    ).run();
    assert.equal(repository.getByIdWithSource("tenant", "invalid-source")?.coverSource, null);
  } finally {
    repository.close();
  }
});

Deno.test("GenerationRepository returns a zero total if a database adapter yields no count row", () => {
  const fakeDatabase = {
    prepare: (_query: string) => ({
      all: (..._parameters: Array<string | number>) => [],
      get: (..._parameters: Array<string | number>) => undefined,
    }),
  };
  const repository = new GenerationRepository(fakeDatabase as unknown as DatabaseSync);
  assert.deepEqual(repository.list("tenant", { query: "", limit: 10, offset: 0 }), {
    items: [],
    total: 0,
  });
});

Deno.test("openRepository migrates and persists a file-backed database", async () => {
  const directory = await Deno.makeTempDir();
  const path = `${directory}/nested/music.sqlite`;
  await Deno.mkdir(`${directory}/nested`);
  try {
    const first = openRepository(path);
    first.create("tenant", makeInput(), NOW, "persisted");
    first.close();

    const second = openRepository(path);
    assert.equal(second.getById("tenant", "persisted")?.id, "persisted");
    second.close();
    assert.ok((await Deno.stat(path)).isFile);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
