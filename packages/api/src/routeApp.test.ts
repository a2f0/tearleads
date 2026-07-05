import { describe, expect, mock, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { isListContainersResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { registerServiceUser } from "../test/helpers/registerServiceUser";
import { createServiceTestRuntime } from "../test/helpers/serviceRuntime";
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
    const res = await app.request("/containers");

    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ error: "blocked by injected auth" });
  });

  test("does not gate product routes on user account billing state", async () => {
    const { fingerprint, registration } = await registerServiceUser();
    await db
      .update(users)
      .set({
        accountStatus: "disabled",
        disabledAt: new Date("2026-06-01T00:00:00.000Z"),
        purgeAfter: new Date("2026-07-01T00:00:00.000Z"),
      })
      .where(eq(users.id, registration.userId));

    const requireAuth: MiddlewareHandler<SessionEnv> = async (c, next) => {
      c.set("sessionToken", "test-token");
      c.set("session", {
        id: "test-session",
        userId: registration.userId,
        fingerprint,
        createdAt: Date.now(),
        ipAddresses: [],
        lastActiveAt: Date.now(),
        lastActiveIp: null,
      });
      await next();
    };

    const app = createRouteApp({
      requireAuth,
      runtime: createServiceTestRuntime(),
    });
    const res = await app.request("/containers");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(isListContainersResponse(body)).toBe(true);
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
