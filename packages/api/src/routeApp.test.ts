import { describe, expect, mock, test } from "bun:test";
import type { MiddlewareHandler } from "hono";
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
