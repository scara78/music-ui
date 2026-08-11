import assert from "node:assert/strict";
import { COVER_MODELS, TRACK_MODELS } from "@contracts/index.ts";

const SERVER_ENV = [
  "API_PORT",
  "API_HOST",
  "DATABASE_PATH",
  "AUDIO_STORAGE_PATH",
  "DEFAULT_TENANT_ID",
  "ALLOW_TENANT_HEADER",
  "MINIMAX_API_KEY",
  "MINIMAX_BASE_URL",
  "MINIMAX_MODEL",
] as const;

function ephemeralLoopbackPort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  try {
    return (listener.addr as Deno.NetAddr).port;
  } finally {
    listener.close();
  }
}

Deno.test("real server entrypoint serves health and safe configuration and shuts down cleanly", async () => {
  const temporaryRoot = await Deno.makeTempDir();
  const previousEnvironment = new Map(
    SERVER_ENV.map((name) => [name, Deno.env.get(name)] as const),
  );
  const port = ephemeralLoopbackPort();
  let runtime: typeof import("../src/server.ts") | undefined;

  Deno.env.set("API_PORT", String(port));
  Deno.env.set("API_HOST", "127.0.0.1");
  Deno.env.set("DATABASE_PATH", `${temporaryRoot}/database/music.db`);
  Deno.env.set("AUDIO_STORAGE_PATH", `${temporaryRoot}/audio`);
  Deno.env.set("DEFAULT_TENANT_ID", "server-test");
  Deno.env.set("ALLOW_TENANT_HEADER", "false");
  Deno.env.set("MINIMAX_API_KEY", "");
  Deno.env.set("MINIMAX_BASE_URL", "https://api.example.invalid");
  Deno.env.set("MINIMAX_MODEL", "music-3.0-free");

  try {
    runtime = await import("../src/server.ts");
    const baseUrl = `http://127.0.0.1:${port}`;

    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });

    const config = await fetch(`${baseUrl}/api/config`);
    assert.equal(config.status, 200);
    assert.deepEqual(await config.json(), {
      apiKeyConfigured: false,
      defaultModel: "music-3.0-free",
      availableModels: TRACK_MODELS,
      availableTrackModels: TRACK_MODELS,
      availableCoverModels: COVER_MODELS,
      freeRateLimitRpm: 3,
    });
  } finally {
    if (runtime) {
      try {
        await runtime.server.shutdown();
        await runtime.server.finished;
      } finally {
        runtime.repository.close();
      }
    }
    for (const [name, value] of previousEnvironment) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
    await Deno.remove(temporaryRoot, { recursive: true });
  }
});
