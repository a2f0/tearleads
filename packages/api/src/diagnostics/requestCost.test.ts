import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createDefaultManagedApiDatabase } from "@tearleads/api-shared/postgres";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { createRouteApp } from "../routeApp";
import {
  createRequestCostMiddleware,
  readApiRequestCostLog,
} from "./requestCost";

const SERVER_TIMING = /^total;dur=(\d+(?:\.\d)?), db;dur=(\d+(?:\.\d)?)$/;
const consoleLog = spyOn(console, "log").mockImplementation(() => {});

afterEach(() => {
  consoleLog.mockClear();
});

function costLines(): unknown[] {
  return consoleLog.mock.calls.flatMap(([line]) =>
    typeof line === "string" && line.includes("api.request.cost")
      ? [JSON.parse(line)]
      : [],
  );
}

function serverTiming(response: Response): { total: number; db: number } {
  const match = SERVER_TIMING.exec(response.headers.get("Server-Timing") ?? "");
  if (!match) {
    throw new Error("Server-Timing is missing or malformed");
  }
  return { total: Number(match[1]), db: Number(match[2]) };
}

describe("readApiRequestCostLog", () => {
  test("logs only when the Worker enables it", () => {
    expect(readApiRequestCostLog({})).toBe(false);
    expect(readApiRequestCostLog({ API_REQUEST_COST_LOG: "false" })).toBe(
      false,
    );
    expect(readApiRequestCostLog({ API_REQUEST_COST_LOG: " true " })).toBe(
      true,
    );
  });
});

describe("createRequestCostMiddleware", () => {
  test("times database work and logs the route template", async () => {
    const managed = createDefaultManagedApiDatabase({ API_DATABASE: "memory" });
    const items = new Hono();
    items.get("/items/:itemId/children/:childId", async (c) => {
      await managed.db.execute(
        sql`select count(*) from generate_series(1, 20000)`,
      );
      await managed.db.execute(sql`select 1`);
      return c.json({ ok: true });
    });
    const app = new Hono();
    app.use("*", createRequestCostMiddleware({ log: true }));
    app.route("/", items);
    try {
      const response = await app.request(
        "/items/item-secret-7f3a/children/child-secret-91c2?token=query-secret",
      );

      expect(response.status).toBe(200);
      const timing = serverTiming(response);
      expect(timing.db).toBeGreaterThan(0);
      expect(costLines()).toEqual([
        {
          event: "api.request.cost",
          method: "GET",
          route: "/items/{itemId}/children/{childId}",
          status: 200,
          statements: 2,
          wallMs: timing.total,
          dbMs: timing.db,
        },
      ]);
      const logged = consoleLog.mock.calls.flat().join("\n");
      expect(logged).not.toContain("secret");
    } finally {
      await managed.close();
    }
  });

  test("records the error handler's status", async () => {
    const app = new Hono();
    app.use("*", createRequestCostMiddleware({ log: true }));
    app.get("/failures/:failureId", () => {
      throw new Error("handler failed");
    });
    app.onError((_error, c) => c.json({ error: "Internal" }, 500));

    const response = await app.request("/failures/failure-secret");

    expect(response.status).toBe(500);
    serverTiming(response);
    expect(costLines()).toMatchObject([
      { route: "/failures/{failureId}", status: 500, statements: 0 },
    ]);
  });
});

describe("route app request cost", () => {
  test("is quiet by default but still answers Server-Timing", async () => {
    const app = createRouteApp({}, { corsOrigins: "*" });

    const response = await app.request("/");

    expect(response.status).toBe(200);
    expect(serverTiming(response).db).toBe(0);
    expect(costLines()).toEqual([]);
  });

  test("logs templates for refused and unmatched requests", async () => {
    const app = createRouteApp({}, { corsOrigins: "*", requestCostLog: true });

    const refused = await app.request(
      "/documents/document-secret-5e1b/attribution",
    );
    const unmatched = await app.request("/missing/missing-secret-22d0");

    expect(refused.status).toBe(401);
    expect(unmatched.status).toBe(404);
    serverTiming(unmatched);
    expect(costLines()).toMatchObject([
      {
        method: "GET",
        route: "/documents/{documentId}/attribution",
        status: 401,
      },
      { method: "GET", route: "unmatched", status: 404 },
    ]);
    expect(consoleLog.mock.calls.flat().join("\n")).not.toContain("secret");
  });

  test("leaves answered preflights untimed and exposes the header", async () => {
    const app = createRouteApp(
      {},
      { corsOrigins: ["https://app.example.test"], requestCostLog: true },
    );

    const preflight = await app.request("/auth/sessions", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.example.test",
        "Access-Control-Request-Method": "GET",
      },
    });
    const response = await app.request("/", {
      headers: { Origin: "https://app.example.test" },
    });

    expect(preflight.headers.get("Server-Timing")).toBeNull();
    expect(
      response.headers.get("Access-Control-Expose-Headers")?.toLowerCase(),
    ).toContain("server-timing");
    expect(costLines()).toMatchObject([{ route: "/", status: 200 }]);
  });
});
