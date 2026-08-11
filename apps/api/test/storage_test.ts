import assert from "node:assert/strict";
import { AppError } from "../src/errors.ts";
import { LocalAudioStorage, mimeTypeFor } from "../src/storage.ts";
import { captureAppErrorAsync } from "./fixtures.ts";

Deno.test("mimeTypeFor maps every supported audio format", () => {
  assert.equal(mimeTypeFor("wav"), "audio/wav");
  assert.equal(mimeTypeFor("pcm"), "audio/L16");
  assert.equal(mimeTypeFor("mp3"), "audio/mpeg");
});

Deno.test("LocalAudioStorage saves, hashes, and reads tenant-scoped audio", async () => {
  const root = await Deno.makeTempDir();
  try {
    const storage = new LocalAudioStorage(root);
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const stored = await storage.save("tenant_A", "generation-1", "wav", bytes);
    assert.equal(stored.path, `${root}/tenant_A/generations/generation-1/audio.wav`);
    assert.equal(stored.mimeType, "audio/wav");
    assert.equal(stored.sizeBytes, 6);
    assert.equal(stored.sha256, "3f2d1552cdc7483f40dd720c80b900225dfecfd5cae7cd168d79ab6ee5959885");
    assert.deepEqual(await storage.read(stored.path), bytes);
    await assert.rejects(() => Deno.stat(`${stored.path}.tmp`), Deno.errors.NotFound);
    await storage.delete(stored.path);
    await assert.rejects(() => Deno.stat(stored.path), Deno.errors.NotFound);
    await storage.delete(stored.path);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("LocalAudioStorage handles empty files and rejects unsafe path segments", async () => {
  const root = await Deno.makeTempDir();
  try {
    const storage = new LocalAudioStorage(root);
    const empty = await storage.save("tenant", "generation", "pcm", new Uint8Array());
    assert.equal(empty.sizeBytes, 0);
    assert.equal(empty.sha256, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

    const unsafeSegments: Array<readonly [string, string]> = [
      ["../tenant", "generation"],
      ["tenant", "bad/path"],
    ];
    for (const [tenant, generation] of unsafeSegments) {
      const error = await captureAppErrorAsync(() =>
        storage.save(tenant, generation, "mp3", new Uint8Array([1]))
      );
      assert.ok(error instanceof AppError);
      assert.equal(error.status, 400);
      assert.equal(error.code, "invalid_storage_key");
    }
    await assert.rejects(() => storage.read(`${root}/missing.mp3`), Deno.errors.NotFound);

    const outside = await captureAppErrorAsync(() =>
      storage.read(`${root}-outside/generations/audio.mp3`)
    );
    assert.equal(outside.status, 400);
    assert.equal(outside.code, "invalid_storage_path");

    await assert.rejects(() => storage.read(root));
    await assert.rejects(() => storage.delete(root));
    const deleteOutside = await captureAppErrorAsync(() => storage.delete(`${root}-outside/a.mp3`));
    assert.equal(deleteOutside.code, "invalid_storage_path");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
