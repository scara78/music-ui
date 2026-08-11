import type { AudioFormat } from "@contracts/index.ts";
import { resolve, sep } from "node:path";
import { AppError } from "./errors.ts";

export interface StoredAudio {
  path: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export interface AudioStorage {
  save(
    tenantId: string,
    generationId: string,
    format: AudioFormat,
    bytes: Uint8Array,
  ): Promise<StoredAudio>;
  read(path: string): Promise<Uint8Array>;
  delete(path: string): Promise<void>;
}

export function mimeTypeFor(format: AudioFormat): string {
  if (format === "wav") return "audio/wav";
  if (format === "pcm") return "audio/L16";
  return "audio/mpeg";
}

function safeSegment(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) {
    throw new AppError(400, "invalid_storage_key", "Invalid media storage key.");
  }
  return value;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class LocalAudioStorage implements AudioStorage {
  private readonly resolvedRoot: string;

  constructor(private readonly root: string) {
    this.resolvedRoot = resolve(root);
  }

  async save(
    tenantId: string,
    generationId: string,
    format: AudioFormat,
    bytes: Uint8Array,
  ): Promise<StoredAudio> {
    const tenant = safeSegment(tenantId);
    const generation = safeSegment(generationId);
    const directory = `${this.root}/${tenant}/generations/${generation}`;
    const path = `${directory}/audio.${format}`;
    const temporaryPath = `${path}.tmp`;
    await Deno.mkdir(directory, { recursive: true });
    await Deno.writeFile(temporaryPath, bytes);
    await Deno.rename(temporaryPath, path);
    return {
      path,
      mimeType: mimeTypeFor(format),
      sizeBytes: bytes.byteLength,
      sha256: await sha256(bytes),
    };
  }

  read(path: string): Promise<Uint8Array> {
    return Deno.readFile(this.resolvePath(path));
  }

  async delete(path: string): Promise<void> {
    try {
      await Deno.remove(this.resolvePath(path));
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }

  private resolvePath(path: string): string {
    const resolvedPath = resolve(path);
    if (
      resolvedPath !== this.resolvedRoot && !resolvedPath.startsWith(`${this.resolvedRoot}${sep}`)
    ) {
      throw new AppError(
        400,
        "invalid_storage_path",
        "Media path is outside the configured storage root.",
      );
    }
    return resolvedPath;
  }
}
