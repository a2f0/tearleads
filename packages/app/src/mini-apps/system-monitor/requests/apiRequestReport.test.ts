import { expect, test } from "bun:test";
import { ApiRequestMetrics } from "@tearleads/client-sdk";
import { listSessionsOperation } from "@tearleads/validators/operation";
import { formatSystemMonitorReport } from "../report/systemMonitorReport";

test("the copied monitor report includes request totals and endpoint outcomes", () => {
  const metrics = new ApiRequestMetrics();
  metrics.begin("alice", listSessionsOperation)("succeeded");
  metrics.begin("alice", listSessionsOperation)("failed");
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
});
