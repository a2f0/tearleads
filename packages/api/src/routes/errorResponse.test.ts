import { expect, spyOn, test } from "bun:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createApiErrorHandler } from "../diagnostics/errorHandler";
import * as diagnostics from "../diagnostics/sentry";
import type { SessionEnv } from "../middleware/session";
import { respondToStatusError } from "./errorResponse";

const secret = "SYNTHETIC_PRIVATE_DOMAIN_TEXT";

class SyntheticDomainError extends Error {
  constructor(
    message: string,
    readonly status: ContentfulStatusCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

function app(errors: ReadonlyArray<readonly [string, () => Error]>) {
  const instance = new Hono<SessionEnv>();
  for (const [path, error] of errors) {
    instance.get(`/${path}`, (c) =>
      respondToStatusError(c, error(), SyntheticDomainError, {
        code: "synthetic_not_found",
        status: 404,
      }),
    );
  }
  instance.onError(createApiErrorHandler(() => {}));
  return instance;
}

test("a 500+ domain error is captured where it is answered", async () => {
  const capture = spyOn(diagnostics, "captureApiError").mockImplementation(
    () => {},
  );
  try {
    const response = await app([
      ["server", () => new SyntheticDomainError(secret, 500)],
    ]).request("/server");
    expect(response.status).toBe(500);
    expect(capture).toHaveBeenCalledTimes(1);
    const [error, source] = capture.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(SyntheticDomainError);
    expect(source).toBe("request-error");
  } finally {
    capture.mockRestore();
  }
});

test("a deliberate 503 keeps its retryable status and body", async () => {
  // Propagating it to the shared handler instead would answer a 500 unless the
  // cause chain happened to look like driver contention, so a caller that
  // retries on 503 would stop retrying a transient billing or provisioning
  // outage. Domain errors of this class carry no cause at all.
  const capture = spyOn(diagnostics, "captureApiError").mockImplementation(
    () => {},
  );
  try {
    const response = await app([
      ["unavailable", () => new SyntheticDomainError(secret, 503)],
    ]).request("/unavailable");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: secret });
    expect(capture).toHaveBeenCalledTimes(1);
  } finally {
    capture.mockRestore();
  }
});

test("client statuses answer unchanged and are never captured", async () => {
  const capture = spyOn(diagnostics, "captureApiError").mockImplementation(
    () => {},
  );
  try {
    const response = await app([
      ["client", () => new SyntheticDomainError(secret, 404)],
    ]).request("/client");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: "synthetic_not_found",
      error: secret,
    });
    expect(capture).not.toHaveBeenCalled();
  } finally {
    capture.mockRestore();
  }
});

test("a non-domain error still propagates to the shared 500 handler", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  const capture = spyOn(diagnostics, "captureApiError").mockImplementation(
    () => {},
  );
  try {
    const instance = new Hono<SessionEnv>();
    instance.get("/other", (c) =>
      respondToStatusError(c, new Error(secret), SyntheticDomainError),
    );
    const handler = spyOn({ capture: () => {} }, "capture");
    instance.onError(createApiErrorHandler(handler));
    const response = await instance.request("/other");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal Server Error" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(capture).not.toHaveBeenCalled();
  } finally {
    capture.mockRestore();
    log.mockRestore();
  }
});
