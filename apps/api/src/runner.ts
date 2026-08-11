import type { CreateAnyGenerationInput } from "@contracts/index.ts";
import { describeProviderError } from "./errors.ts";
import type { MusicProvider } from "./minimax.ts";
import type { GenerationRepository, InternalGeneration } from "./repository.ts";
import type { AudioStorage } from "./storage.ts";

export type Clock = () => number;
export type Sleeper = (milliseconds: number) => Promise<void>;

interface QueueItem {
  tenantId: string;
  id: string;
}

function generationInput(record: InternalGeneration): CreateAnyGenerationInput {
  if (record.kind === "cover") {
    if (!record.coverSource) throw new Error("Cover reference audio is unavailable.");
    return {
      title: record.title,
      model: record.model as "music-cover-free" | "music-cover",
      prompt: record.prompt,
      lyrics: record.lyrics || undefined,
      source: record.coverSource,
      audio: record.audio,
    };
  }
  return {
    title: record.title,
    model: record.model as "music-3.0-free" | "music-3.0",
    prompt: record.prompt,
    lyrics: record.lyrics,
    lyricsOptimizer: record.lyricsOptimizer,
    instrumental: record.instrumental,
    audio: record.audio,
  };
}

export class GenerationRunner {
  private readonly queue: QueueItem[] = [];
  private readonly queued = new Set<string>();
  private draining: Promise<void> | null = null;
  private lastFreeStartedAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly repository: GenerationRepository,
    private readonly provider: Pick<MusicProvider, "generate">,
    private readonly storage: AudioStorage,
    private readonly freeIntervalMs = 20_000,
    private readonly clock: Clock = Date.now,
    private readonly sleeper: Sleeper = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  enqueue(tenantId: string, id: string): void {
    const key = `${tenantId}:${id}`;
    if (this.queued.has(key)) return;
    this.queued.add(key);
    this.queue.push({ tenantId, id });
    this.draining ??= this.drain().finally(() => {
      this.draining = null;
    });
  }

  recover(): void {
    this.repository.markInterrupted(new Date(this.clock()).toISOString());
    for (const record of this.repository.listQueued()) this.enqueue(record.tenantId, record.id);
  }

  async waitForIdle(): Promise<void> {
    await this.draining;
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.queued.delete(`${item.tenantId}:${item.id}`);
      await this.process(item);
    }
  }

  private async process(item: QueueItem): Promise<void> {
    const record = this.repository.getByIdWithSource(item.tenantId, item.id);
    if (!record || (record.status !== "queued" && record.status !== "generating")) return;

    if (record.model.endsWith("-free")) {
      const remaining = this.freeIntervalMs - (this.clock() - this.lastFreeStartedAt);
      if (remaining > 0) await this.sleeper(remaining);
      this.lastFreeStartedAt = this.clock();
    }

    this.repository.markGenerating(item.tenantId, item.id, new Date(this.clock()).toISOString());
    try {
      const generated = await this.provider.generate(generationInput(record));
      const stored = await this.storage.save(
        item.tenantId,
        item.id,
        record.audio.format,
        generated.bytes,
      );
      this.repository.markCompleted(item.tenantId, item.id, {
        audioPath: stored.path,
        audioMimeType: stored.mimeType,
        durationMs: generated.durationMs,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        traceId: generated.traceId,
      }, new Date(this.clock()).toISOString());
    } catch (error) {
      const failure = describeProviderError(error);
      this.repository.markFailed(
        item.tenantId,
        item.id,
        failure.code,
        failure.message,
        new Date(this.clock()).toISOString(),
        failure.traceId,
      );
    }
  }
}
