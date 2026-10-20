import { expect, test } from "bun:test";
import { ApiRequestMetrics } from "@tearleads/client-sdk";
import {
  getBlobBytesOperation,
  type HttpOperation,
  listSessionsOperation,
} from "@tearleads/validators/operation";
import { formatSystemMonitorReport } from "../report/systemMonitorReport";
import { formatApiRequestReport } from "./apiRequestReport";
import { formatDurationMs } from "./apiRequestTiming";

test("the copied monitor report includes request totals and endpoint outcomes", () => {
  let nowMs = 0;
  const metrics = new ApiRequestMetrics(() => nowMs);
  const first = metrics.begin("alice", listSessionsOperation);
  nowMs += 120;
  first("succeeded", { totalMs: 80, databaseMs: 4.25 });
  const second = metrics.begin("alice", listSessionsOperation);
  nowMs += 30;
  second("failed");
  const report = formatSystemMonitorReport({
    apiRequests: metrics.getSnapshot("alice"),
    capturedAt: "2026-10-13T00:00:00Z",
    environment: [],
    logEntries: [],
    status: {
      events: [],
      id: "db-1",
      network: "online",
      peerUserId: null,
      publicKey: "alice",
      session: "active",
      sqliteWorker: "ready",
      userId: "user-1",
      ws: "connected",
    },
  });
  expect(report).toContain("## API Requests");
  expect(report).toContain("| Total requests | 2 |");
  expect(report).toContain("| GET /auth/sessions | 2 | 0 | 1 | 1 | 0 |");
  expect(report).toContain("### Timing");
  expect(report).toContain(
    "| Endpoint | Total ms | p50 ms | p95 ms | Max ms | Server p50 ms | DB p50 ms |",
  );
  expect(report).toContain(
    "| GET /auth/sessions | 150 | 30 | 120 | 120 | 80 | 4.3 |",
  );
});

test("timing lists the slowest endpoints first and blanks unreported server time", () => {
  let nowMs = 0;
  const metrics = new ApiRequestMetrics(() => nowMs);
  const timed = (operation: HttpOperation, ms: number) => {
    const finish = metrics.begin(null, operation);
    nowMs += ms;
    finish("succeeded");
  };
  timed(listSessionsOperation, 2.5);
  timed(getBlobBytesOperation, 400);
  metrics.begin(null, listSessionsOperation);
  const lines = formatApiRequestReport(metrics.getSnapshot(null));
  const timing = lines.at(-1)?.split("\n").slice(2);
  expect(timing).toEqual([
    `| ${getBlobBytesOperation.method} ${getBlobBytesOperation.path} | 400 | 400 | 400 | 400 |  |  |`,
    "| GET /auth/sessions | 2.5 | 2.5 | 2.5 | 2.5 |  |  |",
  ]);
  expect(
    formatApiRequestReport(new ApiRequestMetrics().getSnapshot(null)).at(-1),
  ).toEndWith("| --- | --- | --- | --- | --- | --- | --- |");
  expect([0, 9.94, 9.96, 10.4, 1234.5].map(formatDurationMs)).toEqual([
    "0.0",
    "9.9",
    "10.0",
    "10",
    "1235",
  ]);
});
