import { expect, test } from "bun:test";
import { emptyTraffic } from "../realtime/postgresWire";
import type { ReloadMeasurement } from "./measureReload";
import { requestCounts } from "./requestCounts";
import { formatReload, summarizeReloads } from "./summary";

function reload(
  overrides: Partial<ReloadMeasurement> & Pick<ReloadMeasurement, "reload">,
): ReloadMeasurement {
  return {
    documents: 100,
    folders: 10,
    sample: 1,
    settledMs: 300,
    requests: 10,
    byRoute: [],
    database: { ...emptyTraffic(), statements: 40 },
    localSql: { calls: 200, durationMs: 12 },
    ...overrides,
  };
}

test("request counts merge a route's scopes and sort largest first", () => {
  const endpoint = (method: string, path: string, total: number) => ({
    method,
    path,
    total,
    inFlight: 0,
    succeeded: total,
    failed: 0,
    cancelled: 0,
    duration: null,
    serverDuration: null,
    databaseDuration: null,
  });
  expect(
    requestCounts([
      endpoint("POST", "/documents/{documentId}/sync", 1),
      endpoint("GET", "/containers/{containerId}/writer-projection", 2),
      endpoint("POST", "/containers/parent-lanes/query", 2),
      endpoint("POST", "/documents/{documentId}/sync", 2),
    ]),
  ).toEqual([
    { route: "POST /documents/{documentId}/sync", count: 3 },
    { route: "GET /containers/{containerId}/writer-projection", count: 2 },
    { route: "POST /containers/parent-lanes/query", count: 2 },
  ]);
});

test("summaries keep first and settled reloads of a size apart", () => {
  const summary = summarizeReloads([
    reload({
      reload: "first",
      requests: 101,
      settledMs: 3_000,
      byRoute: [
        { route: "GET /documents/{documentId}/writer-projection", count: 90 },
      ],
    }),
    reload({ reload: "settled", sample: 1, requests: 10, settledMs: 300 }),
    reload({
      reload: "settled",
      sample: 2,
      requests: 12,
      settledMs: 500,
      byRoute: [{ route: "POST /containers/parent-lanes/query", count: 4 }],
    }),
    reload({
      reload: "settled",
      sample: 3,
      requests: 10,
      settledMs: 400,
      byRoute: [{ route: "POST /containers/parent-lanes/query", count: 3 }],
    }),
  ]);
  expect(summary).toEqual([
    {
      documents: 100,
      folders: 10,
      reload: "first",
      samples: 1,
      medianRequests: 101,
      maxRequests: 101,
      medianSettledMs: 3_000,
      medianStatements: 40,
      medianLocalStatements: 200,
      maxByRoute: [
        { route: "GET /documents/{documentId}/writer-projection", count: 90 },
      ],
    },
    {
      documents: 100,
      folders: 10,
      reload: "settled",
      samples: 3,
      medianRequests: 10,
      maxRequests: 12,
      medianSettledMs: 400,
      medianStatements: 40,
      medianLocalStatements: 200,
      maxByRoute: [{ route: "POST /containers/parent-lanes/query", count: 4 }],
    },
  ]);
  expect(formatReload(reload({ reload: "settled", sample: 2 }))).toBe(
    "100 notes in 10 folders, settled #2, 10 requests, settled in 300 ms, 40 statements, 200 local statements",
  );
});
