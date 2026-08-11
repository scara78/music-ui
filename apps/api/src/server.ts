import { dirname } from "node:path";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { MiniMaxClient } from "./minimax.ts";
import { openRepository } from "./repository.ts";
import { GenerationRunner } from "./runner.ts";
import { LocalAudioStorage } from "./storage.ts";

const config = loadConfig();
await Deno.mkdir(dirname(config.databasePath), { recursive: true });
await Deno.mkdir(config.audioStoragePath, { recursive: true });

export const repository = openRepository(config.databasePath);
const storage = new LocalAudioStorage(config.audioStoragePath);
const provider = new MiniMaxClient(config.minimaxApiKey, config.minimaxBaseUrl);
const runner = new GenerationRunner(repository, provider, storage);
const app = createApp({ config, repository, runner, storage, provider });

runner.recover();
console.log(`Music API listening on http://${config.host}:${config.port}`);
export const server = Deno.serve({ port: config.port, hostname: config.host }, app.fetch);
