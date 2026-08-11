import type { Generation } from "@contracts";

export function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return "—:—";
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function formatPlaybackTime(seconds: number): string {
  const totalSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

export function downloadFilename(
  generation: Pick<Generation, "title" | "audio">,
): string {
  const withoutControlCharacters = Array.from(
    generation.title,
    (character) => character.charCodeAt(0) < 32 ? "-" : character,
  ).join("");
  const safeTitle = withoutControlCharacters
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 120) || "track";
  return `${safeTitle}.${generation.audio.format}`;
}

export function isCoverGeneration(
  generation: Pick<Generation, "model">,
): boolean {
  return String(generation.model).startsWith("music-cover");
}

export function generationKindLabel(
  generation: Pick<Generation, "model" | "instrumental">,
): "Cover" | "Instrumental" | "Vocal" {
  if (isCoverGeneration(generation)) return "Cover";
  return generation.instrumental ? "Instrumental" : "Vocal";
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "Not available";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(iso: string, now = Date.now()): string {
  const delta = now - new Date(iso).getTime();
  if (delta >= 0 && delta < 60_000) return "just now";
  if (delta >= 0 && delta < 3_600_000) {
    return `${Math.floor(delta / 60_000)}m ago`;
  }
  if (delta >= 0 && delta < 86_400_000) {
    return `${Math.floor(delta / 3_600_000)}h ago`;
  }
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" })
    .format(new Date(iso));
}

export function generationHue(generation: Pick<Generation, "id">): number {
  return Array.from(generation.id).reduce(
    (sum, character) => sum + character.charCodeAt(0),
    0,
  ) %
    360;
}

export function filterGenerations(
  generations: Generation[],
  query: string,
  status: "all" | Generation["status"],
): Generation[] {
  const normalized = query.trim().toLowerCase();
  return generations.filter((generation) => {
    const matchesStatus = status === "all" || generation.status === status;
    const matchesQuery = !normalized ||
      `${generation.title} ${generation.prompt} ${generation.lyrics}`
        .toLowerCase().includes(
          normalized,
        );
    return matchesStatus && matchesQuery;
  });
}
