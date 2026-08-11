import assert from "node:assert/strict";
import type { AudioFormat, CreateAnyGenerationInput } from "@contracts/index.ts";
import { ProviderError } from "../src/errors.ts";
import type { GeneratedAudio, MusicProvider } from "../src/minimax.ts";
import { openMemoryRepository } from "../src/repository.ts";
import { GenerationRunner } from "../src/runner.ts";
import type { AudioStorage, StoredAudio } from "../src/storage.ts";
import { makeInput, NOW } from "./fixtures.ts";

class RecordingProvider implements Pick<MusicProvider, "generate"> {
  readonly inputs: CreateAnyGenerationInput[] = [];

  constructor(
    private readonly handler: (input: CreateAnyGenerationInput) => Promise<GeneratedAudio> = () =>
      Promise.resolve({ bytes: new Uint8Array([1, 2, 3]), durationMs: 3210, traceId: "trace" }),
  ) {}

  generate(input: CreateAnyGenerationInput): Promise<GeneratedAudio> {
    this.inputs.push(input);
    return this.handler(input);
  }
}

class RecordingStorage implements AudioStorage {
  readonly saves: Array<
    { tenantId: string; generationId: string; format: AudioFormat; bytes: Uint8Array }
  > = [];

  constructor(private readonly failingId: string | null = null) {}

  save(
    tenantId: string,
    generationId: string,
    format: AudioFormat,
    bytes: Uint8Array,
  ): Promise<StoredAudio> {
    this.saves.push({ tenantId, generationId, format, bytes });
    if (generationId === this.failingId) return Promise.reject(new Error("disk unavailable"));
    return Promise.resolve({
      path: `/audio/${tenantId}/${generationId}.${format}`,
      mimeType: format === "wav" ? "audio/wav" : "audio/mpeg",
      sizeBytes: bytes.length,
      sha256: `sha-${generationId}`,
    });
  }

  read(_path: string): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array());
  }

  delete(_path: string): Promise<void> {
    return Promise.resolve();
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

Deno.test("GenerationRunner turns a queued paid generation into stored completed audio", async () => {
  const repository = openMemoryRepository();
  try {
    const input = makeInput({
      title: "Paid song",
      model: "music-3.0",
      prompt: "Paid prompt",
      lyrics: "Paid lyrics",
      lyricsOptimizer: false,
      instrumental: false,
      audio: { sampleRate: 24000, bitrate: 64000, format: "wav" },
    });
    repository.create("tenant", input, NOW, "paid");
    const provider = new RecordingProvider();
    const storage = new RecordingStorage();
    const runner = new GenerationRunner(
      repository,
      provider,
      storage,
      20_000,
      () => 1000,
      () => Promise.resolve(),
    );

    runner.enqueue("tenant", "paid");
    await runner.waitForIdle();

    assert.deepEqual(provider.inputs, [input]);
    assert.deepEqual(storage.saves, [{
      tenantId: "tenant",
      generationId: "paid",
      format: "wav",
      bytes: new Uint8Array([1, 2, 3]),
    }]);
    const completed = repository.getById("tenant", "paid")!;
    assert.equal(completed.status, "completed");
    assert.equal(completed.audioPath, "/audio/tenant/paid.wav");
    assert.equal(completed.audioMimeType, "audio/wav");
    assert.equal(completed.durationMs, 3210);
    assert.equal(completed.sizeBytes, 3);
    assert.equal(completed.sha256, "sha-paid");
    assert.equal(completed.traceId, "trace");
  } finally {
    repository.close();
  }
});

Deno.test("GenerationRunner serializes the queue and deduplicates items still waiting", async () => {
  const repository = openMemoryRepository();
  try {
    repository.create("tenant", makeInput({ title: "First", model: "music-3.0" }), NOW, "first");
    repository.create("tenant", makeInput({ title: "Second", model: "music-3.0" }), NOW, "second");
    const gate = deferred();
    const provider = new RecordingProvider(async (input) => {
      if (input.title === "First") await gate.promise;
      return { bytes: new Uint8Array([1]), durationMs: null, traceId: null };
    });
    const runner = new GenerationRunner(
      repository,
      provider,
      new RecordingStorage(),
      0,
      () => 0,
      () => Promise.resolve(),
    );

    runner.enqueue("tenant", "first");
    runner.enqueue("tenant", "second");
    runner.enqueue("tenant", "second");
    gate.resolve();
    await runner.waitForIdle();

    assert.deepEqual(provider.inputs.map((input) => input.title), ["First", "Second"]);
    assert.equal(repository.getById("tenant", "first")?.status, "completed");
    assert.equal(repository.getById("tenant", "second")?.status, "completed");
  } finally {
    repository.close();
  }
});

Deno.test("GenerationRunner ignores missing and terminal records but can finish an already-generating record", async () => {
  const repository = openMemoryRepository();
  try {
    repository.create("tenant", makeInput({ title: "Done", model: "music-3.0" }), NOW, "done");
    repository.markCompleted("tenant", "done", {
      audioPath: "/done.mp3",
      audioMimeType: "audio/mpeg",
      durationMs: null,
      sizeBytes: 1,
      sha256: "done",
      traceId: null,
    }, NOW);
    repository.create(
      "tenant",
      makeInput({ title: "In progress", model: "music-3.0" }),
      NOW,
      "generating",
    );
    repository.markGenerating("tenant", "generating", NOW);
    const provider = new RecordingProvider();
    const runner = new GenerationRunner(
      repository,
      provider,
      new RecordingStorage(),
      0,
      () => 0,
      () => Promise.resolve(),
    );

    await runner.waitForIdle();
    runner.enqueue("tenant", "missing");
    runner.enqueue("tenant", "done");
    runner.enqueue("tenant", "generating");
    await runner.waitForIdle();

    assert.deepEqual(provider.inputs.map((input) => input.title), ["In progress"]);
    assert.equal(repository.getById("tenant", "done")?.status, "completed");
    assert.equal(repository.getById("tenant", "generating")?.status, "completed");
  } finally {
    repository.close();
  }
});

Deno.test("GenerationRunner enforces the free-model interval and advances through the injected sleeper", async () => {
  const repository = openMemoryRepository();
  try {
    repository.create("tenant", makeInput({ title: "Free one" }), NOW, "free-one");
    repository.create("tenant", makeInput({ title: "Free two" }), NOW, "free-two");
    let time = 1_000;
    const sleeps: number[] = [];
    const runner = new GenerationRunner(
      repository,
      new RecordingProvider(),
      new RecordingStorage(),
      20_000,
      () => time,
      (milliseconds) => {
        sleeps.push(milliseconds);
        time += milliseconds;
        return Promise.resolve();
      },
    );

    runner.enqueue("tenant", "free-one");
    runner.enqueue("tenant", "free-two");
    await runner.waitForIdle();

    assert.deepEqual(sleeps, [20_000]);
    assert.equal(repository.getById("tenant", "free-one")?.status, "completed");
    assert.equal(repository.getById("tenant", "free-two")?.status, "completed");
  } finally {
    repository.close();
  }
});

Deno.test("GenerationRunner classifies provider, storage, and unknown failures", async () => {
  const repository = openMemoryRepository();
  try {
    repository.create(
      "tenant",
      makeInput({ title: "Provider failure", model: "music-3.0" }),
      NOW,
      "provider",
    );
    repository.create(
      "tenant",
      makeInput({ title: "Unknown failure", model: "music-3.0" }),
      NOW,
      "unknown",
    );
    repository.create(
      "tenant",
      makeInput({ title: "Storage failure", model: "music-3.0" }),
      NOW,
      "storage",
    );
    const provider = new RecordingProvider((input) => {
      if (input.title === "Provider failure") {
        return Promise.reject(new ProviderError("1002", "Rate limited", "provider-trace"));
      }
      if (input.title === "Unknown failure") return Promise.reject("unexpected value");
      return Promise.resolve({ bytes: new Uint8Array([1]), durationMs: null, traceId: null });
    });
    const runner = new GenerationRunner(
      repository,
      provider,
      new RecordingStorage("storage"),
      0,
      () => 0,
      () => Promise.resolve(),
    );

    runner.enqueue("tenant", "provider");
    runner.enqueue("tenant", "unknown");
    runner.enqueue("tenant", "storage");
    await runner.waitForIdle();

    assert.equal(repository.getById("tenant", "provider")?.errorCode, "1002");
    assert.equal(repository.getById("tenant", "provider")?.errorMessage, "Rate limited");
    assert.equal(repository.getById("tenant", "provider")?.traceId, "provider-trace");
    assert.equal(repository.getById("tenant", "unknown")?.errorCode, "unknown_error");
    assert.equal(repository.getById("tenant", "unknown")?.errorMessage, "Unknown generation error");
    assert.equal(repository.getById("tenant", "storage")?.errorCode, "transport_error");
    assert.equal(repository.getById("tenant", "storage")?.errorMessage, "disk unavailable");
  } finally {
    repository.close();
  }
});

Deno.test("GenerationRunner recovery fails interrupted work and resumes only queued rows", async () => {
  const repository = openMemoryRepository();
  try {
    repository.create("tenant", makeInput({ title: "Queued", model: "music-3.0" }), NOW, "queued");
    repository.create(
      "tenant",
      makeInput({ title: "Interrupted", model: "music-3.0" }),
      NOW,
      "interrupted",
    );
    repository.markGenerating("tenant", "interrupted", NOW);
    const provider = new RecordingProvider();
    const clock = () => Date.parse("2026-08-11T13:00:00.000Z");
    const runner = new GenerationRunner(
      repository,
      provider,
      new RecordingStorage(),
      0,
      clock,
      () => Promise.resolve(),
    );

    runner.recover();
    await runner.waitForIdle();

    assert.deepEqual(provider.inputs.map((input) => input.title), ["Queued"]);
    assert.equal(repository.getById("tenant", "queued")?.status, "completed");
    const interrupted = repository.getById("tenant", "interrupted")!;
    assert.equal(interrupted.status, "failed");
    assert.equal(interrupted.errorCode, "interrupted");
    assert.equal(interrupted.updatedAt, "2026-08-11T13:00:00.000Z");
  } finally {
    repository.close();
  }
});

Deno.test("GenerationRunner default sleeper is exercised without a long delay", async () => {
  const repository = openMemoryRepository();
  try {
    repository.create("tenant", makeInput({ title: "Default sleeper" }), NOW, "default-sleeper");
    const runner = new GenerationRunner(
      repository,
      new RecordingProvider(),
      new RecordingStorage(),
      1,
    );
    const internals = runner as unknown as { lastFreeStartedAt: number };
    internals.lastFreeStartedAt = Date.now() + 2;
    runner.enqueue("tenant", "default-sleeper");
    await runner.waitForIdle();
    assert.equal(repository.getById("tenant", "default-sleeper")?.status, "completed");
  } finally {
    repository.close();
  }
});

Deno.test("GenerationRunner restores durable cover inputs and rejects missing references", async () => {
  const repository = openMemoryRepository();
  const provider = new RecordingProvider();
  const storage = new RecordingStorage();
  try {
    const cover = repository.create(
      "tenant",
      {
        title: "Cover",
        model: "music-cover",
        prompt: "Smooth late-night jazz cover",
        lyrics: "Edited cover lyrics",
        source: { type: "feature", featureId: "feature-id" },
        audio: { sampleRate: 44100, bitrate: 256000, format: "mp3" },
      },
      NOW,
      "cover",
    );
    const runner = new GenerationRunner(repository, provider, storage, 0, () => Date.parse(NOW));
    runner.enqueue("tenant", cover.id);
    await runner.waitForIdle();
    assert.deepEqual(provider.inputs, [{
      title: "Cover",
      model: "music-cover",
      prompt: "Smooth late-night jazz cover",
      lyrics: "Edited cover lyrics",
      source: { type: "feature", featureId: "feature-id" },
      audio: { sampleRate: 44100, bitrate: 256000, format: "mp3" },
    }]);

    const asr = repository.create(
      "tenant",
      {
        title: "ASR cover",
        model: "music-cover",
        prompt: "Acoustic late-night cover",
        source: { type: "url", url: "https://audio.example/song.mp3" },
        audio: { sampleRate: 44100, bitrate: 256000, format: "mp3" },
      },
      NOW,
      "asr-cover",
    );
    runner.enqueue("tenant", asr.id);
    await runner.waitForIdle();
    assert.equal(provider.inputs[1]?.lyrics, undefined);

    const missing = repository.create(
      "tenant",
      {
        title: "Missing reference",
        model: "music-cover",
        prompt: "Smooth late-night jazz cover",
        source: { type: "url", url: "https://audio.example/song.mp3" },
        audio: { sampleRate: 44100, bitrate: 256000, format: "mp3" },
      },
      NOW,
      "missing-cover",
    );
    const originalGet = repository.getByIdWithSource.bind(repository);
    repository.getByIdWithSource = (tenantId, id) => {
      const record = originalGet(tenantId, id);
      return record && id === "missing-cover" ? { ...record, coverSource: null } : record;
    };
    runner.enqueue("tenant", missing.id);
    await runner.waitForIdle();
    assert.equal(repository.getById("tenant", missing.id)?.status, "failed");
    assert.equal(
      repository.getById("tenant", missing.id)?.errorMessage,
      "Cover reference audio is unavailable.",
    );
  } finally {
    repository.close();
  }
});
