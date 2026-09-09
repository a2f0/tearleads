import { expect, spyOn, test } from "bun:test";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { SessionEnv } from "../middleware/session";
import { createApiErrorHandler } from "./errorHandler";
import { resolveApiSentryConfig } from "./sentryConfig";

test("API captures unexpected failures, preserves CORS/status, and ignores client errors", async () => {
  const capture = spyOn({ capture: (_error: unknown) => {} }, "capture");
  const log = spyOn(console, "error").mockImplementation(() => {});
  const app = new Hono<SessionEnv>();
  app.use("*", cors({ origin: "https://app.tearleads.com" }));
  app.get("/client", () => {
    throw new HTTPException(401);
  });
  app.get("/server", () => {
    throw new HTTPException(502);
  });
  app.get("/unexpected", () => {
    throw new Error("SYNTHETIC_PRIVATE_SQL");
  });
  app.get("/database", () => {
    throw Object.assign(new Error("SYNTHETIC_PRIVATE_SQL"), {
      code: "STREAM_EXPIRED",
    });
  });
  app.onError(createApiErrorHandler(capture));
  try {
    for (const [path, status] of [
      ["client", 401],
      ["server", 502],
      ["unexpected", 500],
      ["database", 503],
    ] as const) {
      const response = await app.request(`/${path}`, {
        headers: { Origin: "https://app.tearleads.com" },
      });
      expect(response.status).toBe(status);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://app.tearleads.com",
      );
    }
    expect(capture).toHaveBeenCalledTimes(3);
  } finally {
    log.mockRestore();
    capture.mockRestore();
  }
});

test("API diagnostics require a hosted DSN, explicit tier, and compiled commit", () => {
  const input = {
    dsn: `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`,
    environment: "production",
    commit: "b".repeat(40),
    sourceRoot: "/build",
    sourcePaths: ["/packages/api/src/index.ts"],
  };
  expect(resolveApiSentryConfig(input)?.release).toBe(
    `tearleads-api@${input.commit}`,
  );
  for (const change of [
    { dsn: undefined },
    { dsn: "https://attacker.invalid/1" },
    { environment: "prod" },
    { commit: "unknown" },
  ])
    expect(resolveApiSentryConfig({ ...input, ...change })).toBeUndefined();
});
