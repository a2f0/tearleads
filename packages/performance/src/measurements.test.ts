import { expect, test } from "bun:test";
import { sanitizeCostEvent } from "./costEvents";
import { openLocalDatabase } from "./localDatabase";
import { parseOptions } from "./options";
import { provision, type Sample } from "./provision";
import { summarize } from "./report";

test("explicit target, bounded serial sample count, and no silent flag mistakes", () => {
  expect(() => parseOptions([])).toThrow("explicitly");
  for (const count of ["0", "11", "Infinity", "2.1", "1e1", "-1"]) {
    expect(() =>
      parseOptions(["--env", "production", "--samples", count]),
    ).toThrow();
  }
  expect(() => parseOptions(["--env", "prod"])).toThrow();
  expect(() =>
    parseOptions(["--env", "staging", "--concurrency", "10"]),
  ).toThrow();
  expect(parseOptions(["--env", "staging"])).toEqual({
    environment: "staging",
    samples: 1,
    cloudflare: false,
  });
  expect(parseOptions(["--help"])).toBeNull();
});

test("Cloudflare events require exact correlation and cannot retain raw logs or credentials", () => {
  const trace = {
    eventTimestamp: 123,
    event: {
      request: {
        url: "https://example.test/secret",
        headers: {
          "X-Tearleads-Perf-Run": "run",
          "X-Tearleads-Perf-Request": "run-1-1",
          authorization: "secret",
        },
      },
    },
    logs: [
      {
        message: [
          "secret",
          JSON.stringify({
            event: "api.request.cost",
            statements: 1000,
            wallMs: 7000,
            dbMs: 6800,
            status: 200,
            secret: "secret",
            route: "/private-id",
          }),
        ],
      },
    ],
    exceptions: [{ message: "secret" }],
  };
  expect(sanitizeCostEvent(trace, "another-run")).toBeNull();
  const cost = sanitizeCostEvent(trace, "run");
  expect(cost).toEqual({
    requestId: "run-1-1",
    eventTimestamp: 123,
    cpuMs: null,
    wallMs: null,
    costs: [{ statements: 1000, wallMs: 7000, dbMs: 6800, status: 200 }],
  });
  expect(JSON.stringify(cost)).not.toContain("secret");
  expect(JSON.stringify(cost)).not.toContain("private-id");
});

test("local database adapter supports rollback, named binds, and array rows", async () => {
  const db = await openLocalDatabase();
  try {
    await db.client.exec({ sql: "CREATE TABLE items (id TEXT PRIMARY KEY)" });
    await db.client.exec({ sql: "BEGIN" });
    await db.client.exec({
      sql: "INSERT INTO items VALUES ($id)",
      bind: { $id: "a" },
    });
    expect(
      (await db.client.exec({ sql: "SELECT id FROM items", rowMode: "array" }))
        .rows,
    ).toEqual([["a"]]);
    await db.client.exec({ sql: "ROLLBACK" });
    expect(
      (await db.client.exec({ sql: "SELECT id FROM items" })).rows,
    ).toEqual([]);
    expect(db.measurements.calls).toBe(6);
  } finally {
    db.close();
  }
});

test("SDK refusal is a failed sample and always restores process fetch", async () => {
  let calls = 0;
  const server = Bun.serve({
    port: 0,
    fetch: () => {
      calls++;
      return Response.json({ error: "refused" }, { status: 429 });
    },
  });
  const originalFetch = globalThis.fetch;
  try {
    const sample = await provision({
      origin: server.url.origin,
      runId: "test",
      index: 1,
      signal: AbortSignal.timeout(10_000),
    });
    expect(sample.status).toBe("failed");
    expect(sample.failurePhase).toBe("registration");
    expect(sample.requests[0]?.status).toBe(429);
    expect(calls).toBe(1);
    expect(globalThis.fetch).toBe(originalFetch);
    expect(sample.userId).toBeNull();
  } finally {
    await server.stop(true);
  }
});

test("summary excludes setup/logout and failed runs from provision percentiles", () => {
  const sample: Sample = {
    id: "test",
    status: "passed",
    failurePhase: null,
    startedAt: "now",
    phases: ["setup", "identity", "registration", "login", "logout"].map(
      (name) => ({ name, startMs: 0, durationMs: 100 }),
    ),
    requests: [],
    localSql: { calls: 0, durationMs: 0 },
    userId: null,
    organizationId: null,
    sessionRevoked: true,
  };
  expect(summarize([sample, { ...sample, status: "failed" }])).toEqual({
    attempted: 2,
    passed: 1,
    failed: 1,
    provisionMs: { p50: 300, p95: 300, max: 300 },
  });
  expect(summarize([]).provisionMs.p50).toBeNull();
});
