import { expect, spyOn, test } from "bun:test";
import { apiVersionHeaderName } from "@tearleads/validators/operation";
import type { MiddlewareHandler } from "hono";
import type { SessionEnv } from "../middleware/session";
import { createRouteApp, routeApp } from "../routeApp";

test("stamps the build on successful, failed, and unknown-route responses", async () => {
  const errorLog = spyOn(console, "error").mockImplementation(() => {});
  try {
    const requireAuth: MiddlewareHandler<SessionEnv> = async () => {
      throw new Error("unexpected failure");
    };
    const app = createRouteApp({ requireAuth }, { apiVersion: 2461 });

    const responses = await Promise.all([
      app.request("/"),
      app.request("/containers/parent-lanes/query", { method: "POST" }),
      app.request("/no-such-route"),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      200, 500, 404,
    ]);
    for (const response of responses) {
      expect(response.headers.get(apiVersionHeaderName)).toBe("2461");
    }
  } finally {
    errorLog.mockRestore();
  }
});

test("exposes the build header to cross-origin clients", async () => {
  const app = createRouteApp(
    {},
    { apiVersion: 2461, corsOrigins: ["https://app.example.test"] },
  );

  const response = await app.request("/", {
    headers: { Origin: "https://app.example.test" },
  });

  expect(
    response.headers.get("Access-Control-Expose-Headers")?.toLowerCase(),
  ).toContain(apiVersionHeaderName.toLowerCase());
  expect(response.headers.get(apiVersionHeaderName)).toBe("2461");
});

test("an API run from source or an unversioned build sends no build header", async () => {
  const unversioned = createRouteApp({}, { apiVersion: null });

  for (const app of [routeApp, unversioned]) {
    const response = await app.request("/");
    expect(response.status).toBe(200);
    expect(response.headers.has(apiVersionHeaderName)).toBe(false);
  }
});
