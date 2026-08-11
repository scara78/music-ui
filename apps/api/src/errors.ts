import type { ApiError } from "@contracts/index.ts";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly traceId: string | null = null,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export function toApiError(
  error: unknown,
): { status: number; body: ApiError; headers?: Record<string, string> } {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: { error: { code: error.code, message: error.message, fields: error.fields } },
      headers: error.headers,
    };
  }
  return {
    status: 500,
    body: { error: { code: "internal_error", message: "Something went wrong." } },
  };
}

export function describeProviderError(
  error: unknown,
): { code: string; message: string; traceId: string | null } {
  if (error instanceof ProviderError) {
    return { code: error.code, message: error.message, traceId: error.traceId };
  }
  if (error instanceof Error) {
    return { code: "transport_error", message: error.message, traceId: null };
  }
  return { code: "unknown_error", message: "Unknown generation error", traceId: null };
}
