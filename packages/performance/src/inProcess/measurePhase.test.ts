import { expect, test } from "bun:test";
import { emptyHttpTraffic } from "./httpCounterProxy";
import { measureProtocolPhase } from "./measurePhase";
import { emptyTraffic } from "./postgresWire";

test("captures HTTP, PostgreSQL, local SQLite, and resource deltas for a phase", async () => {
  let http = emptyHttpTraffic();
  const db = emptyTraffic();
  const local = { calls: 10, durationMs: 4.2 };

  const { value, stats } = await measureProtocolPhase({
    http: () => http,
    traffic: () => ({ ...db }),
    device: () => ({
      localSql: () => ({ ...local }),
      captureSqlWindow: () => ({
        finish: () => ({
          top: [{ sql: "SELECT 1", count: 3, durationMs: 1.5 }],
          mutations: 1,
          maxMutationHoldMs: 1.2,
          maxStatementsPerMutation: 3,
        }),
      }),
    }),
    run: async () => {
      http = {
        requests: 2,
        conflicts: 1,
        requestBytes: 300,
        responseBytes: 500,
        byRoute: {
          "POST /containers/:containerId/revoke": {
            count: 2,
            conflicts: 1,
            requestBytes: 300,
            responseBytes: 500,
          },
        },
      };
      db.statements += 14;
      db.roundTrips += 14;
      db.rows += 20;
      local.calls += 7;
      local.durationMs += 5.4;
      return "done";
    },
  });

  expect(value).toBe("done");
  expect(stats.http.requests).toBe(2);
  expect(stats.http.conflicts).toBe(1);
  expect(stats.database.statements).toBe(14);
  expect(stats.localSql).toEqual({
    calls: 7,
    durationMs: 5,
    attribution: {
      top: [{ sql: "SELECT 1", count: 3, durationMs: 1.5 }],
      mutations: 1,
      maxMutationHoldMs: 1.2,
      maxStatementsPerMutation: 3,
    },
  });
  expect(stats.resources.samples).toBeGreaterThanOrEqual(1);
});

test("captures newly created device local SQL when device resolves after run", async () => {
  let created = false;
  const { stats } = await measureProtocolPhase({
    http: emptyHttpTraffic,
    traffic: emptyTraffic,
    device: () =>
      created ? { localSql: () => ({ calls: 12, durationMs: 8.6 }) } : null,
    run: async () => {
      created = true;
    },
  });
  expect(stats.localSql).toEqual({ calls: 12, durationMs: 9 });
});
