import { DatabaseSync } from "node:sqlite";
import type {
  AudioFormat,
  Bitrate,
  CoverGenerationSource,
  CreateAnyGenerationInput,
  Generation,
  GenerationModel,
  GenerationStatus,
  SampleRate,
} from "@contracts/index.ts";
import type { ListFilters } from "./validation.ts";

interface GenerationRow {
  id: string;
  tenant_id: string;
  kind: string;
  title: string;
  model: string;
  prompt: string;
  lyrics: string;
  lyrics_optimizer: number;
  instrumental: number;
  sample_rate: number;
  bitrate: number;
  format: string;
  status: string;
  audio_path: string | null;
  audio_mime_type: string | null;
  duration_ms: number | null;
  size_bytes: number | null;
  sha256: string | null;
  trace_id: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  retry_of_id: string | null;
  cover_source_type: string | null;
  cover_source_value: string | null;
}

export interface InternalGeneration extends Generation {
  tenantId: string;
  audioPath: string | null;
  audioMimeType: string | null;
  sha256: string | null;
  retryOfId: string | null;
  coverSource: CoverGenerationSource | null;
}

export interface CompletionData {
  audioPath: string;
  audioMimeType: string;
  durationMs: number | null;
  sizeBytes: number;
  sha256: string;
  traceId: string | null;
}

const SOURCE_SELECT_COLUMNS = `
  id, tenant_id, kind, title, model, prompt, lyrics, lyrics_optimizer, instrumental,
  sample_rate, bitrate, format, status, audio_path, audio_mime_type, duration_ms,
  size_bytes, sha256, trace_id, error_code, error_message, created_at, updated_at,
  completed_at, retry_of_id, cover_source_type, cover_source_value
`;

const METADATA_SELECT_COLUMNS = `
  id, tenant_id, kind, title, model, prompt, lyrics, lyrics_optimizer, instrumental,
  sample_rate, bitrate, format, status, audio_path, audio_mime_type, duration_ms,
  size_bytes, sha256, trace_id, error_code, error_message, created_at, updated_at,
  completed_at, retry_of_id, cover_source_type, NULL AS cover_source_value
`;

function rowCoverSource(row: GenerationRow): CoverGenerationSource | null {
  if (!row.cover_source_type || !row.cover_source_value) return null;
  if (row.cover_source_type === "url") return { type: "url", url: row.cover_source_value };
  if (row.cover_source_type === "base64") return { type: "base64", data: row.cover_source_value };
  if (row.cover_source_type === "feature") {
    return { type: "feature", featureId: row.cover_source_value };
  }
  return null;
}

function rowToGeneration(row: GenerationRow): InternalGeneration {
  const completed = row.status === "completed" && row.audio_path !== null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    kind: row.kind === "cover" ? "cover" : "track",
    title: row.title,
    model: row.model as GenerationModel,
    prompt: row.prompt,
    lyrics: row.lyrics,
    lyricsOptimizer: row.lyrics_optimizer === 1,
    instrumental: row.instrumental === 1,
    audio: {
      sampleRate: row.sample_rate as SampleRate,
      bitrate: row.bitrate as Bitrate,
      format: row.format as AudioFormat,
    },
    status: row.status as GenerationStatus,
    audioPath: row.audio_path,
    audioMimeType: row.audio_mime_type,
    durationMs: row.duration_ms,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    traceId: row.trace_id,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    retryOfId: row.retry_of_id,
    coverSource: rowCoverSource(row),
    audioUrl: completed ? `/api/generations/${row.id}/audio` : null,
  };
}

export class GenerationRepository {
  constructor(private readonly db: DatabaseSync) {}

  migrate(): void {
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    const version = this.db.prepare("PRAGMA user_version").get() as unknown as {
      user_version: number;
    };
    if (version.user_version < 1) {
      this.db.exec(`CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`);
      this.db.exec(`CREATE TABLE IF NOT EXISTS generations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        title TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt TEXT NOT NULL,
        lyrics TEXT NOT NULL,
        lyrics_optimizer INTEGER NOT NULL,
        instrumental INTEGER NOT NULL,
        sample_rate INTEGER NOT NULL,
        bitrate INTEGER NOT NULL,
        format TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued','generating','completed','failed')),
        audio_path TEXT,
        audio_mime_type TEXT,
        duration_ms INTEGER,
        size_bytes INTEGER,
        sha256 TEXT,
        trace_id TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        retry_of_id TEXT REFERENCES generations(id)
      )`);
      this.db.exec("PRAGMA user_version = 1");
    }
    if (version.user_version < 2) {
      const columns = this.db.prepare("PRAGMA table_info(generations)").all() as unknown as Array<{
        name: string;
      }>;
      const names = new Set(columns.map((column) => column.name));
      if (!names.has("kind")) {
        this.db.exec(
          "ALTER TABLE generations ADD COLUMN kind TEXT NOT NULL DEFAULT 'track' CHECK(kind IN ('track','cover'))",
        );
      }
      if (!names.has("cover_source_type")) {
        this.db.exec("ALTER TABLE generations ADD COLUMN cover_source_type TEXT");
      }
      if (!names.has("cover_source_value")) {
        this.db.exec("ALTER TABLE generations ADD COLUMN cover_source_value TEXT");
      }
      this.db.exec("PRAGMA user_version = 2");
    }
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_generations_tenant_created ON generations(tenant_id, created_at DESC)",
    );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_generations_tenant_status ON generations(tenant_id, status)",
    );
    this.db.exec("PRAGMA optimize");
  }

  ensureTenant(tenantId: string, now: string): void {
    this.db.prepare(`INSERT INTO tenants (id, display_name, created_at)
      VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING`).run(tenantId, tenantId, now);
  }

  create(
    tenantId: string,
    input: CreateAnyGenerationInput,
    now: string,
    id: string = crypto.randomUUID(),
    retryOfId: string | null = null,
  ): InternalGeneration {
    this.ensureTenant(tenantId, now);
    const fallbackTitle = input.prompt.split(/[,.!\n]/)[0]?.trim().slice(0, 80) || "Untitled track";
    const cover = "source" in input;
    const sourceType = cover ? input.source.type : null;
    const sourceValue = !cover
      ? null
      : input.source.type === "url"
      ? input.source.url
      : input.source.type === "base64"
      ? input.source.data
      : input.source.featureId;
    this.db.prepare(`INSERT INTO generations (
      id, tenant_id, kind, title, model, prompt, lyrics, lyrics_optimizer, instrumental,
      sample_rate, bitrate, format, status, created_at, updated_at, retry_of_id,
      cover_source_type, cover_source_value
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)`).run(
      id,
      tenantId,
      cover ? "cover" : "track",
      input.title ?? fallbackTitle,
      input.model,
      input.prompt,
      input.lyrics ?? "",
      !cover && input.lyricsOptimizer ? 1 : 0,
      !cover && input.instrumental ? 1 : 0,
      input.audio.sampleRate,
      input.audio.bitrate,
      input.audio.format,
      now,
      now,
      retryOfId,
      sourceType,
      sourceValue,
    );
    return this.getById(tenantId, id)!;
  }

  getById(tenantId: string, id: string): InternalGeneration | null {
    const row = this.db.prepare(
      `SELECT ${METADATA_SELECT_COLUMNS} FROM generations WHERE tenant_id = ? AND id = ?`,
    )
      .get(tenantId, id) as unknown as GenerationRow | undefined;
    return row ? rowToGeneration(row) : null;
  }

  /** Internal worker/retry lookup. This may materialize a large persisted base64 cover source. */
  getByIdWithSource(tenantId: string, id: string): InternalGeneration | null {
    const row = this.db.prepare(
      `SELECT ${SOURCE_SELECT_COLUMNS} FROM generations WHERE tenant_id = ? AND id = ?`,
    )
      .get(tenantId, id) as unknown as GenerationRow | undefined;
    return row ? rowToGeneration(row) : null;
  }

  list(tenantId: string, filters: ListFilters): { items: InternalGeneration[]; total: number } {
    const where = ["tenant_id = ?"];
    const params: Array<string | number> = [tenantId];
    if (filters.status) {
      where.push("status = ?");
      params.push(filters.status);
    }
    if (filters.query) {
      where.push(
        "(title LIKE ? ESCAPE '\\' OR prompt LIKE ? ESCAPE '\\' OR lyrics LIKE ? ESCAPE '\\')",
      );
      const escaped = `%${filters.query.replace(/[\\%_]/g, "\\$&")}%`;
      params.push(escaped, escaped, escaped);
    }
    const clause = where.join(" AND ");
    const rows = this.db.prepare(`SELECT ${METADATA_SELECT_COLUMNS} FROM generations WHERE ${clause}
      ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(
      ...params,
      filters.limit,
      filters.offset,
    ) as unknown as GenerationRow[];
    const count = this.db.prepare(`SELECT COUNT(*) AS count FROM generations WHERE ${clause}`)
      .get(...params) as unknown as { count: number } | undefined;
    return { items: rows.map(rowToGeneration), total: count?.count ?? 0 };
  }

  listQueued(): InternalGeneration[] {
    const rows = this.db.prepare(`SELECT ${METADATA_SELECT_COLUMNS} FROM generations
      WHERE status = 'queued' ORDER BY created_at ASC`).all() as unknown as GenerationRow[];
    return rows.map(rowToGeneration);
  }

  markInterrupted(now: string): void {
    this.db.prepare(`UPDATE generations SET status = 'failed', error_code = 'interrupted',
      error_message = 'Generation was interrupted by an application restart. Retry it explicitly to avoid a duplicate song.',
      updated_at = ? WHERE status = 'generating'`).run(now);
  }

  updateTitle(tenantId: string, id: string, title: string, now: string): InternalGeneration | null {
    this.db.prepare(
      "UPDATE generations SET title = ?, updated_at = ? WHERE tenant_id = ? AND id = ?",
    )
      .run(title, now, tenantId, id);
    return this.getById(tenantId, id);
  }

  delete(tenantId: string, id: string): InternalGeneration | null {
    const record = this.getById(tenantId, id);
    if (!record) return null;
    this.db.prepare(
      "UPDATE generations SET retry_of_id = NULL WHERE tenant_id = ? AND retry_of_id = ?",
    ).run(tenantId, id);
    this.db.prepare("DELETE FROM generations WHERE tenant_id = ? AND id = ?").run(tenantId, id);
    return record;
  }

  markGenerating(tenantId: string, id: string, now: string): void {
    this.db.prepare(`UPDATE generations SET status = 'generating', error_code = NULL,
      error_message = NULL, updated_at = ? WHERE tenant_id = ? AND id = ?`).run(now, tenantId, id);
  }

  markCompleted(tenantId: string, id: string, result: CompletionData, now: string): void {
    this.db.prepare(`UPDATE generations SET status = 'completed', audio_path = ?,
      audio_mime_type = ?, duration_ms = ?, size_bytes = ?, sha256 = ?, trace_id = ?,
      error_code = NULL, error_message = NULL, updated_at = ?, completed_at = ?
      WHERE tenant_id = ? AND id = ?`).run(
      result.audioPath,
      result.audioMimeType,
      result.durationMs,
      result.sizeBytes,
      result.sha256,
      result.traceId,
      now,
      now,
      tenantId,
      id,
    );
  }

  markFailed(
    tenantId: string,
    id: string,
    code: string,
    message: string,
    now: string,
    traceId: string | null = null,
  ): void {
    this.db.prepare(`UPDATE generations SET status = 'failed', error_code = ?,
      error_message = ?, trace_id = COALESCE(?, trace_id), updated_at = ? WHERE tenant_id = ? AND id = ?`)
      .run(
        code,
        message,
        traceId,
        now,
        tenantId,
        id,
      );
  }

  close(): void {
    this.db.close();
  }
}

export function openRepository(path: string): GenerationRepository {
  const database = new DatabaseSync(path);
  const repository = new GenerationRepository(database);
  repository.migrate();
  return repository;
}

export function openMemoryRepository(): GenerationRepository {
  const repository = new GenerationRepository(new DatabaseSync(":memory:"));
  repository.migrate();
  return repository;
}
