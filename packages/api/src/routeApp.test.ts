import { describe, expect, mock, test } from "bun:test";
import type { MiddlewareHandler } from "hono";
import type { SessionEnv } from "./middleware/session";
import { createRouteApp, readApiCorsOrigins, routeApp } from "./routeApp";

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
    const res = await app.request("/containers");

    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ error: "blocked by injected auth" });
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
