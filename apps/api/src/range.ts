import { AppError } from "./errors.ts";

export interface ByteRange {
  start: number;
  end: number;
}

function rangeError(size: number, code: string, message: string): never {
  throw new AppError(416, code, message, undefined, { "content-range": `bytes */${size}` });
}

export function parseByteRange(header: string | null, size: number): ByteRange | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return rangeError(size, "invalid_range", "Invalid audio byte range.");

  const rawStart = match[1]!;
  const rawEnd = match[2]!;
  if (!rawStart && !rawEnd) return rangeError(size, "invalid_range", "Invalid audio byte range.");

  let start: number;
  let end: number;
  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!Number.isInteger(suffix) || suffix <= 0) {
      return rangeError(size, "invalid_range", "Invalid audio byte range.");
    }
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
  }

  if (
    !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start
  ) {
    return rangeError(size, "range_not_satisfiable", "Audio byte range is not satisfiable.");
  }
  return { start, end: Math.min(end, size - 1) };
}
