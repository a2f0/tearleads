import { expect, test } from "bun:test";
import { formatScenarioComparison, formatScenarioReport } from "./markdown";
import type { ScenarioReport, ScenarioRun } from "./report";
import {
  compareScenarios,
  scenarioChanged,
  summarizeScenarios,
} from "./summary";

const baseHttp = {
  requests: 42,
  requestBytes: 12000,
  responseBytes: 34000,
  serverMs: 180.5,
  conflicts: 2,
  clientErrors: 2,
  manifestCitations: 7,
  truncated: false,
  statuses: { "200": 40, "409": 2 },
  errorCodes: { stale_container_write: 2 },
  operations: { removeFromGroup: 1, revoke: 1 },
  byRoute: {
    "POST /containers/:containerId/revoke": {
      count: 1,
      conflicts: 0,
      requestBytes: 1000,
      responseBytes: 500,
      serverMs: 12.1,
    },
    "POST /documents/:documentId/sync": {
      count: 10,
      conflicts: 2,
      requestBytes: 4000,
      responseBytes: 15000,
      serverMs: 80.2,
    },
  },
};

function sampleRun(overrides: Partial<ScenarioRun> = {}): ScenarioRun {
  return {
    scenario: "rotationHistory",
    file: "src/scenarios/rotationHistory.test.ts",
    sample: 1,
    status: "passed",
    exitCode: 0,
    wallMs: 2500,
    tests: { pass: 1, fail: 0 },
    log: "/tmp/rotationHistory-1.log",
    httpCapture: "/tmp/rotationHistory-1.http.jsonl",
    http: baseHttp,
    statements: { status: "off" },
    ...overrides,
  };
}

test("summarizes ranges across samples and formats report and comparison", () => {
  const beforeSummary = summarizeScenarios([
    sampleRun({ sample: 1 }),
    sampleRun({
      sample: 2,
      wallMs: 3100,
      http: {
        ...baseHttp,
        requests: 44,
        conflicts: 3,
        responseBytes: 36000,
      },
    }),
  ]);
  expect(beforeSummary).toHaveLength(1);
  expect(beforeSummary[0]?.requests).toEqual({ min: 42, max: 44 });
  expect(beforeSummary[0]?.conflicts).toEqual({ min: 2, max: 3 });

  const afterSummary = summarizeScenarios([
    sampleRun({
      http: {
        ...baseHttp,
        requests: 36,
        conflicts: 1,
        byRoute: {
          "POST /containers/:containerId/revoke": {
            count: 1,
            conflicts: 0,
            requestBytes: 1000,
            responseBytes: 500,
            serverMs: 10,
          },
          "POST /documents/:documentId/sync": {
            count: 8,
            conflicts: 1,
            requestBytes: 3200,
            responseBytes: 12000,
            serverMs: 60,
          },
        },
      },
    }),
  ]);
  const changes = compareScenarios(beforeSummary, afterSummary);
  expect(changes.filter(scenarioChanged)).toHaveLength(1);
  const comparison = formatScenarioComparison(changes, {
    before: "run before",
    after: "run after",
  });
  expect(comparison).toContain("42–44 → 36 (-6)");
  expect(comparison).toContain("POST /documents/:documentId/sync");

  const report: ScenarioReport = {
    schemaVersion: 1,
    scenario: "bob-and-alice-scenarios",
    runId: "r-1",
    startedAt: "2026-11-27T18:00:00.000Z",
    updatedAt: "2026-11-27T18:01:00.000Z",
    status: "complete",
    revision: "abc1234",
    dirty: false,
    runtime: { bun: "1.4.3", platform: "darwin", arch: "arm64", cpu: "M2" },
    options: {
      scenarios: ["rotation"],
      samples: 2,
      statements: false,
      paramHash: false,
      clientStatements: false,
      payloadAudit: false,
      stacks: false,
    },
    boundary: "test boundary",
    summary: beforeSummary,
    runs: [sampleRun()],
  };
  const markdown = formatScenarioReport(report);
  expect(markdown).toContain("# Multi-party bob-and-alice scenarios");
  expect(markdown).toContain("`rotationHistory`");
  expect(markdown).toContain("`stale_container_write`: 2");
});

test("formats API statements, client SQL, payload audit, and truncation warnings", () => {
  const baseRoute = {
    route: "POST /containers/:containerId/revoke",
    requests: 1,
    statements: 120,
    txStatements: 80,
    lockHoldStatements: 10,
    maxPerRequest: 120,
    sameKeyRepeats: 12,
    pureReadRepeats: 9,
    topRepeat: { sql: "select 1", count: 9 },
  };
  const baseStmtSummary = {
    statements: 120,
    truncated: true,
    paramHashes: true,
    txStatements: 80,
    transactions: 4,
    lockHoldStatements: 10,
    top: [{ sql: "select 1", count: 50 }],
    labels: [],
    phases: [],
    routes: [baseRoute],
  };
  const capturedRun = sampleRun({
    http: { ...baseHttp, truncated: true },
    statements: {
      status: "captured",
      capture: "/tmp/s.jsonl",
      summary: baseStmtSummary,
    },
    clientSql: {
      status: "captured",
      capture: "/tmp/c.jsonl",
      summary: {
        label: "total",
        statements: 240,
        inLockStatements: 100,
        durationMs: 22.5,
        mutations: 15,
        maxMutationHoldMs: 5.1,
        maxMutationWaitMs: 0.4,
        maxStatementsPerMutation: 20,
        avgStatementsPerMutation: 6.7,
        top: [{ sql: "SELECT 1", count: 40, durationMs: 4.2 }],
        truncated: false,
        phases: [],
      },
    },
    payloadAudit: {
      status: "captured",
      capture: "/tmp/p.jsonl",
      summary: {
        requests: 42,
        requestBytes: 12000,
        responseBytes: 34000,
        echoBytes: 256,
        redeliveredBytes: 1024,
        reDownloadedUploadBytes: 0,
        manifestCitations: 7,
        exactHeadRereadsCount: 1,
        byPane: [],
        byRoute: [],
        exactHeadRereads: [],
        topIssuers: [],
      },
    },
  });
  const before = summarizeScenarios([capturedRun]);
  const after = summarizeScenarios([
    {
      ...capturedRun,
      statements: {
        status: "captured",
        capture: "/tmp/s2.jsonl",
        summary: {
          ...baseStmtSummary,
          statements: 95,
          routes: [{ ...baseRoute, statements: 95, pureReadRepeats: 3 }],
        },
      },
    },
  ]);
  const cmp = formatScenarioComparison(compareScenarios(before, after), {
    before: "b",
    after: "a",
  });
  expect(cmp).toContain("Pure repeats");
  expect(cmp).toContain("9 → 3 (-6)");

  const markdown = formatScenarioReport({
    schemaVersion: 1,
    scenario: "bob-and-alice-scenarios",
    runId: "r-2",
    startedAt: "2026-11-27T18:00:00.000Z",
    updatedAt: "2026-11-27T18:01:00.000Z",
    status: "complete",
    revision: "abc1234",
    dirty: false,
    runtime: { bun: "1.4.3", platform: "darwin", arch: "arm64", cpu: "M2" },
    options: {
      scenarios: [],
      samples: 1,
      statements: true,
      paramHash: true,
      clientStatements: true,
      payloadAudit: true,
      stacks: false,
    },
    boundary: "test boundary",
    summary: before,
    runs: [capturedRun],
  });
  expect(markdown).toContain("Warning: capture limit reached");
  expect(markdown).toContain("## API statements: rotationHistory (#1)");
  expect(markdown).toContain("## Client SQLite: rotationHistory (#1)");
  expect(markdown).toContain("## Payload audit: rotationHistory (#1)");
});
