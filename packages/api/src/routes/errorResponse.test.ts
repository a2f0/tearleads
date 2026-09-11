import { expect, spyOn, test } from "bun:test";
import type { ServerErrorSource } from "@tearleads/diagnostics/server";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createApiErrorHandler } from "../diagnostics/errorHandler";
import type { SessionEnv } from "../middleware/session";
import { respondToStatusError } from "./errorResponse";

const secret = "SYNTHETIC_PRIVATE_OBJECT_STORE_TEXT";

class SyntheticDomainError extends Error {
  constructor(
    message: string,
    readonly status: ContentfulStatusCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

const contention = () =>
  new SyntheticDomainError(secret, 503, {
    cause: Object.assign(new Error(secret), { code: "SQLITE_BUSY" }),
  });

test("a 500+ domain error is captured and loses its raw message; client statuses are untouched", async () => {
  const capture = spyOn(
    { capture: (_error: unknown, _source: ServerErrorSource) => {} },
    "capture",
  );
  const log = spyOn(console, "error").mockImplementation(() => {});
  const app = new Hono<SessionEnv>();
  for (const [path, error] of [
    ["client", () => new SyntheticDomainError(secret, 404)],
    ["server", () => new SyntheticDomainError(secret, 500)],
    ["contended", contention],
  ] as const) {
    app.get(`/${path}`, (c) =>
      respondToStatusError(c, error(), SyntheticDomainError, {
        code: "synthetic_not_found",
        status: 404,
      }),
    );
  }
  app.onError(createApiErrorHandler(capture));
  try {
    const client = await app.request("/client");
    expect(client.status).toBe(404);
    expect(await client.json()).toEqual({
      code: "synthetic_not_found",
      error: secret,
    });
    expect(capture).not.toHaveBeenCalled();

    // Before the guard the epilogue returned this body itself, so the real 500
    // it produced never reached `onError` and was never captured.
    const server = await app.request("/server");
    expect(server.status).toBe(500);
    expect(await server.json()).toEqual({ error: "Internal Server Error" });

    // A 5xx domain error wrapping a driver contention failure still answers with
    // the retryable status: the shared handler classifies the whole cause chain.
    const contended = await app.request("/contended");
    expect(contended.status).toBe(503);
    expect(await contended.json()).toEqual({
      error: "Database temporarily unavailable",
    });

    expect(capture).toHaveBeenCalledTimes(2);
    for (const [error, source] of capture.mock.calls) {
      expect(error).toBeInstanceOf(SyntheticDomainError);
      expect(source).toBe("request-error");
    }
  } finally {
    log.mockRestore();
    capture.mockRestore();
  }
});
