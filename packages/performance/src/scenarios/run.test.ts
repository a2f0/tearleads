import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { runTestProcess } from "../testProcess";
import type { ScenarioHttpSummary } from "./httpCapture";
import { parseBunTestCounts, runScenario, scenarioRunStatus } from "./run";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

const passingHttp: ScenarioHttpSummary = {
  requests: 5,
  requestBytes: 100,
  responseBytes: 200,
  serverMs: 12,
  conflicts: 0,
  clientErrors: 0,
  manifestCitations: 0,
  truncated: false,
  statuses: { "200": 5 },
  errorCodes: {},
  operations: {},
  byRoute: {},
};

test("parses Bun pass and fail summaries from scenario logs", () => {
  expect(
    parseBunTestCounts("bun test v1.4.3\n\n 2 pass\n 0 fail\nRan 2 tests\n"),
  ).toEqual({ pass: 2, fail: 0 });
  expect(parseBunTestCounts("no summary here")).toBeNull();
});

test("classifies passed, failed, timed-out, and unprofiled scenario runs", () => {
  expect(scenarioRunStatus(0, false, { pass: 1, fail: 0 }, passingHttp)).toBe(
    "passed",
  );
  expect(scenarioRunStatus(null, true, null, null)).toBe("timed-out");
  expect(scenarioRunStatus(1, false, { pass: 0, fail: 1 }, passingHttp)).toBe(
    "failed",
  );
  expect(scenarioRunStatus(0, false, { pass: 1, fail: 0 }, null)).toBe(
    "unprofiled",
  );
  expect(
    scenarioRunStatus(
      0,
      false,
      { pass: 1, fail: 0 },
      { ...passingHttp, requests: 0 },
    ),
  ).toBe("unprofiled");
});

test("runScenario clears ambient PERF_* env vars and reads optional captures", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "scenario-run-"));
  directories.push(root);
  const calls: Parameters<typeof runTestProcess>[0][] = [];
  const log = resolve(root, "run.log");
  const httpCapture = resolve(root, "run.http.jsonl");
  const stmtOut = resolve(root, "run.statements.jsonl");
  const clientOut = resolve(root, "run.client.jsonl");
  const run = await runScenario({
    scenario: { name: "demo", file: "src/scenarios/demo.test.ts" },
    sample: 1,
    log,
    httpCapture,
    statements: { out: stmtOut, paramHash: true },
    clientSql: { out: clientOut },
    root,
    baseEnv: {
      PATH: "/usr/bin",
      PERF_PAYLOAD_AUDIT_OUT: "/tmp/stale-payload.jsonl",
      PERF_PAYLOAD_AUDIT_STACKS: "1",
    },
    runTests: async (spec) => {
      calls.push(spec);
      await writeFile(spec.log, "1 pass\n0 fail\n");
      await writeFile(
        httpCapture,
        `${JSON.stringify({
          kind: "http",
          route: "POST /containers/:containerId/revoke",
          method: "POST",
          status: 200,
          requestBytes: 100,
          responseBytes: 50,
          durationMs: 5,
          knownManifestsCount: 1,
        })}\n`,
      );
      await writeFile(
        stmtOut,
        `${JSON.stringify({ label: "test-1", sql: "select 1", params: 0 })}\n`,
      );
      await writeFile(
        clientOut,
        `${JSON.stringify({
          kind: "stmt",
          label: "test-1",
          sql: "SELECT 1",
          bindCount: 0,
          durationMs: 0.4,
          rows: 1,
          inLock: false,
          failed: false,
        })}\n`,
      );
      return { exitCode: 0, timedOut: false, wallMs: 42 };
    },
  });

  expect(run.status).toBe("passed");
  expect(run.http?.requests).toBe(1);
  expect(run.statements.status).toBe("captured");
  expect(run.clientSql?.status).toBe("captured");
  expect(calls[0]?.env).toMatchObject({
    API_DATABASE: "memory",
    PERF_SCENARIO_HTTP_OUT: httpCapture,
    PERF_STATEMENTS_OUT: stmtOut,
    PERF_STATEMENTS_PARAM_HASH: "1",
    PERF_CLIENT_SQL_OUT: clientOut,
  });
  expect(calls[0]?.env).not.toHaveProperty("PERF_PAYLOAD_AUDIT_OUT");
  expect(calls[0]?.env).not.toHaveProperty("PERF_PAYLOAD_AUDIT_STACKS");
});
