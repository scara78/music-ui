import assert from "node:assert/strict";
import { AppError, describeProviderError, ProviderError, toApiError } from "../src/errors.ts";
import { parseByteRange } from "../src/range.ts";
import { captureAppError } from "./fixtures.ts";

Deno.test("error helpers preserve safe application and provider details", () => {
  const appError = new AppError(422, "bad_input", "Fix it", { prompt: "Required" });
  assert.equal(appError.name, "AppError");
  assert.deepEqual(toApiError(appError), {
    status: 422,
    body: { error: { code: "bad_input", message: "Fix it", fields: { prompt: "Required" } } },
    headers: undefined,
  });
  assert.deepEqual(
    toApiError(new AppError(429, "busy", "Wait", undefined, { "retry-after": "5" })),
    {
      status: 429,
      body: { error: { code: "busy", message: "Wait", fields: undefined } },
      headers: { "retry-after": "5" },
    },
  );
  assert.deepEqual(toApiError(new Error("secret details")), {
    status: 500,
    body: { error: { code: "internal_error", message: "Something went wrong." } },
  });

  const providerError = new ProviderError("rate_limit", "Slow down");
  assert.equal(providerError.name, "ProviderError");
  assert.deepEqual(describeProviderError(providerError), {
    code: "rate_limit",
    message: "Slow down",
    traceId: null,
  });
  assert.deepEqual(describeProviderError(new Error("socket closed")), {
    code: "transport_error",
    message: "socket closed",
    traceId: null,
  });
  assert.deepEqual(describeProviderError("not an Error"), {
    code: "unknown_error",
    message: "Unknown generation error",
    traceId: null,
  });
  assert.deepEqual(describeProviderError(new ProviderError("bad", "Nope", "trace-1")), {
    code: "bad",
    message: "Nope",
    traceId: "trace-1",
  });
});

Deno.test("parseByteRange handles absent, exact, open, suffix, and clamped ranges", () => {
  assert.equal(parseByteRange(null, 10), null);
  assert.deepEqual(parseByteRange(" bytes=2-5 ", 10), { start: 2, end: 5 });
  assert.deepEqual(parseByteRange("bytes=4-", 10), { start: 4, end: 9 });
  assert.deepEqual(parseByteRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.deepEqual(parseByteRange("bytes=-30", 10), { start: 0, end: 9 });
  assert.deepEqual(parseByteRange("bytes=8-99", 10), { start: 8, end: 9 });
});

Deno.test("parseByteRange distinguishes malformed and unsatisfiable ranges", () => {
  for (
    const header of [
      "items=0-1",
      "bytes=-",
      "bytes=-0",
      `bytes=-${"9".repeat(400)}`,
    ]
  ) {
    const error = captureAppError(() => parseByteRange(header, 10));
    assert.equal(error.status, 416);
    assert.equal(error.code, "invalid_range");
    assert.deepEqual(error.headers, { "content-range": "bytes */10" });
  }

  for (
    const header of [
      "bytes=10-",
      "bytes=7-6",
      `bytes=${"9".repeat(400)}-`,
      `bytes=1-${"9".repeat(400)}`,
      "bytes=0-",
    ]
  ) {
    const size = header === "bytes=0-" ? 0 : 10;
    const error = captureAppError(() => parseByteRange(header, size));
    assert.equal(error.status, 416);
    assert.equal(error.code, "range_not_satisfiable");
    assert.deepEqual(error.headers, { "content-range": `bytes */${size}` });
  }
});
