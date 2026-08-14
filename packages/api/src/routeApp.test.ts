import { describe, expect, mock, test } from "bun:test";
import type { MiddlewareHandler } from "hono";
import { readApiCorsOrigins } from "./corsOrigins";
import type { SessionEnv } from "./middleware/session";
import { createRouteApp, routeApp } from "./routeApp";

describe("GET /", () => {
  test("returns ok", async () => {
    const res = await routeApp.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "ok" });
  });
});

describe("createRouteApp", () => {
  test("allows configured production CORS origins", async () => {
    const app = createRouteApp(
      {},
      { corsOrigins: ["https://app.example.test"] },
    );

    const response = await app.request("/", {
      headers: { Origin: "https://app.example.test" },
    });

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.example.test",
    );
  });

  test("allows the multipart blob part headers in CORS preflight", async () => {
    const app = createRouteApp(
      {},
      { corsOrigins: ["https://app.example.test"] },
    );

    const response = await app.request(
      "/blobs/stages/multipart/35069150-b8c1-4052-8003-9780f080aa08/parts/2/bytes",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://app.example.test",
          "Access-Control-Request-Method": "PUT",
          "Access-Control-Request-Headers":
            "x-tearleads-blob-part-byte-length, x-tearleads-blob-part-sha256, x-tearleads-blob-upload-id",
        },
      },
    );

    const allowHeaders =
      response.headers.get("Access-Control-Allow-Headers")?.toLowerCase() ?? "";
    expect(allowHeaders).toContain("x-tearleads-blob-part-byte-length");
    expect(allowHeaders).toContain("x-tearleads-blob-part-sha256");
    expect(allowHeaders).toContain("x-tearleads-blob-upload-id");
  });

  test("does not emit CORS allow-origin for unconfigured origins", async () => {
    const app = createRouteApp(
      {},
      { corsOrigins: ["https://app.example.test"] },
    );

    const response = await app.request("/", {
      headers: { Origin: "https://attacker.example.test" },
    });

    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  test("requires explicit CORS origins in production", () => {
    expect(() => readApiCorsOrigins({ NODE_ENV: "production" })).toThrow(
      "API_CORS_ORIGINS is required when NODE_ENV=production",
    );
    expect(() => readApiCorsOrigins({ NODE_ENV: "production " })).toThrow(
      "API_CORS_ORIGINS is required when NODE_ENV=production",
    );
  });

  test("parses configured CORS origins", () => {
    expect(
      readApiCorsOrigins({
        API_CORS_ORIGINS:
          "https://app.example.test, https://admin.example.test",
        NODE_ENV: "production",
      }),
    ).toEqual(["https://app.example.test", "https://admin.example.test"]);
  });

  test("uses the injected auth middleware for protected routes", async () => {
    const requireAuth: MiddlewareHandler<SessionEnv> = async (c) => {
      return c.json({ error: "blocked by injected auth" }, 418);
    };

    const app = createRouteApp({ requireAuth });
    const res = await app.request("/containers/parent-lanes/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lanes: [{ laneId: "root", parentId: null, watermark: null }],
      }),
    });

    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ error: "blocked by injected auth" });
  });

  test("maps transient libSQL transport failures to 503", async () => {
    const transportError = Object.assign(new Error("socket closed"), {
      code: "HRANA_WEBSOCKET_ERROR",
    });
    const requireAuth: MiddlewareHandler<SessionEnv> = async () => {
      throw new Error("Failed query", { cause: transportError });
    };

    const app = createRouteApp({ requireAuth });
    const response = await app.request("/containers/parent-lanes/query", {
      method: "POST",
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Database temporarily unavailable",
    });
  });

  test("uses the injected destroySession implementation for logout", async () => {
    const destroySession = mock(async () => {});
    const requireAuth: MiddlewareHandler<SessionEnv> = async (_c, next) => {
      await next();
    };

    const app = createRouteApp({ destroySession, requireAuth });
    const res = await app.request("/auth/logout", { method: "POST" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "ok" });
    expect(destroySession).toHaveBeenCalledTimes(1);
  });
});
