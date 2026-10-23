import { expect, spyOn, test } from "bun:test";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { SessionEnv } from "../middleware/session";
import { OrganizationSyncDisabledError } from "../workflows/billing/organizationSyncEligibility";
import { createApiErrorHandler } from "./errorHandler";

test("API captures unexpected failures, preserves CORS/status, and ignores client errors", async () => {
  const capture = spyOn({ capture: (_error: unknown) => {} }, "capture");
  const log = spyOn(console, "error").mockImplementation(() => {});
  const app = new Hono<SessionEnv>();
  app.use("*", cors({ origin: "https://app.tearleads.com" }));
  app.get("/entitlement", () => {
    throw new OrganizationSyncDisabledError(
      "synthetic-org",
      "billing_inactive",
    );
  });
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
      ["entitlement", 402],
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
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({ code: "STREAM_EXPIRED" }),
      "request-error",
      undefined,
      { route: "/database", method: "GET", status: 503 },
    );
  } finally {
    log.mockRestore();
    capture.mockRestore();
  }
});

test.each([
  "PG_CONNECT_TIMEOUT",
  "PG_POOL_TIMEOUT",
  "PG_CONNECTION_UNAVAILABLE",
])(
  "%s returns a retryable 503 and reports a template without the private URL",
  async (code) => {
    const capture = spyOn({ capture: (_error: unknown) => {} }, "capture");
    const log = spyOn(console, "error").mockImplementation(() => {});
    const app = new Hono<SessionEnv>();
    app.post("/documents/:documentId", () => {
      throw new Error("private SQL", {
        cause: Object.assign(new Error("private password"), { code }),
      });
    });
    app.onError(createApiErrorHandler(capture));
    try {
      const response = await app.request(
        "/documents/private-id?token=private-token",
        { method: "POST" },
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "Database temporarily unavailable",
      });
      expect(capture).toHaveBeenCalledWith(
        expect.any(Error),
        "request-error",
        undefined,
        { route: "/documents/{documentId}", method: "POST", status: 503 },
      );
    } finally {
      capture.mockRestore();
      log.mockRestore();
    }
  },
);
