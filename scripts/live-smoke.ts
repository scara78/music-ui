import {
  type CreateGenerationInput,
  type Generation,
  type GenerationListResponse,
  MUSIC_MODELS,
  type MusicModel,
} from "@contracts";

const baseUrl = (Deno.args[0] ?? "http://127.0.0.1:4321").replace(/\/$/, "");
const modelArgument = Deno.args[1] ?? "music-3.0-free";
if (!MUSIC_MODELS.some((model) => model === modelArgument)) {
  throw new Error(`Model must be one of: ${MUSIC_MODELS.join(", ")}`);
}
const model = modelArgument as MusicModel;
const timeoutAt = Date.now() + 12 * 60 * 1000;
const title = `Cadence ${model} integration check`;
const paidVocal = model === "music-3.0";

const input: CreateGenerationInput = {
  title,
  model,
  prompt: paidVocal
    ? "Dreamy synth-pop, warm female alto, intimate verses, wide uplifting chorus, 104 BPM."
    : "Calm minimal ambient piano instrumental, no vocals, gentle room reverb.",
  lyrics: paidVocal
    ? `[Verse]
City lights dissolve into the rain
I hear tomorrow calling out my name

[Pre Chorus]
Every shadow opens into gold

[Chorus]
Carry me home through the electric blue
Every road is leading back to you

[Outro]
Back to you`
    : "",
  lyricsOptimizer: false,
  instrumental: !paidVocal,
  audio: { sampleRate: 16000, bitrate: 32000, format: "mp3" },
};

const privateFields = [
  "tenantId",
  "audioPath",
  "audioMimeType",
  "sha256",
  "retryOfId",
] as const;

function assertPublicGeneration(value: Generation): void {
  const record = value as unknown as Record<string, unknown>;
  for (const field of privateFields) {
    if (field in record) throw new Error(`Public generation leaked ${field}`);
  }
}

const createdResponse = await fetch(`${baseUrl}/api/generations`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(input),
});

if (createdResponse.status !== 202) {
  throw new Error(`Create failed (${createdResponse.status}): ${await createdResponse.text()}`);
}

let generation = await createdResponse.json() as Generation;
assertPublicGeneration(generation);
console.log(`Queued live generation ${generation.id}`);

while (generation.status === "queued" || generation.status === "generating") {
  if (Date.now() >= timeoutAt) throw new Error("Timed out waiting for MiniMax generation");
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const response = await fetch(`${baseUrl}/api/generations/${generation.id}`);
  if (!response.ok) throw new Error(`Polling failed (${response.status})`);
  generation = await response.json() as Generation;
  assertPublicGeneration(generation);
  console.log(`Status: ${generation.status}`);
}

if (generation.status !== "completed" || !generation.audioUrl) {
  throw new Error(
    `Generation failed: ${generation.errorCode ?? "unknown"} ${generation.errorMessage ?? ""}`
      .trim(),
  );
}
if (!generation.completedAt) throw new Error("Completed generation omitted completedAt");
if (!generation.sizeBytes || generation.sizeBytes <= 0) {
  throw new Error("Completed generation omitted a positive sizeBytes");
}
if (!generation.durationMs || generation.durationMs <= 0) {
  throw new Error("Completed generation omitted a positive durationMs");
}

const historyResponse = await fetch(
  `${baseUrl}/api/generations?limit=100&offset=0&q=${encodeURIComponent(title)}`,
);
if (!historyResponse.ok) throw new Error(`History check failed (${historyResponse.status})`);
const history = await historyResponse.json() as GenerationListResponse;
const historyGeneration = history.items.find((item) => item.id === generation.id);
if (!historyGeneration) throw new Error("Completed generation was missing from history");
assertPublicGeneration(historyGeneration);

const audioResponse = await fetch(`${baseUrl}${generation.audioUrl}`, {
  headers: { range: "bytes=0-31" },
});
if (audioResponse.status !== 206) {
  throw new Error(`Audio range check failed (${audioResponse.status})`);
}
const audio = new Uint8Array(await audioResponse.arrayBuffer());
if (audio.byteLength !== 32) throw new Error(`Audio range had ${audio.byteLength} bytes`);
if (audioResponse.headers.get("accept-ranges") !== "bytes") {
  throw new Error("Audio response omitted byte-range support");
}
if (audioResponse.headers.get("content-length") !== "32") {
  throw new Error("Audio response returned the wrong content length");
}
if (
  audioResponse.headers.get("content-range") !==
    `bytes 0-31/${generation.sizeBytes}`
) {
  throw new Error("Audio response returned the wrong content range");
}
if (audioResponse.headers.get("content-type") !== "audio/mpeg") {
  throw new Error("Audio response returned the wrong MIME type");
}
const validMp3 = String.fromCharCode(...audio.slice(0, 3)) === "ID3" ||
  (audio[0] === 0xff && (audio[1]! & 0xe0) === 0xe0);
if (!validMp3) throw new Error("Audio range did not begin with MP3 data");

console.log(
  `Live smoke passed: ${generation.id}, ${generation.sizeBytes ?? 0} bytes, trace ${
    generation.traceId ?? "n/a"
  }`,
);
