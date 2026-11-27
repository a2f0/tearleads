import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractCanariesMetrics } from "./extract";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tearleads-epoch-extract-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("extractCanariesMetrics", () => {
  test("extracts full canary metrics and keeps uncaptured optional metrics null", async () => {
    const dir = await makeTempDir();
    const stmtPath = join(dir, "c1.statements.jsonl");
    const sqlPath = join(dir, "c1.client-sql.jsonl");
    await writeFile(
      stmtPath,
      [
        JSON.stringify({
          requestScope: 1,
          method: "POST",
          route: "/documents",
          status: 200,
        }),
        JSON.stringify({
          label: "t",
          sql: "select 1",
          params: 0,
          request: 1,
          tx: 1,
          paramHash: "aaa",
        }),
        JSON.stringify({
          label: "t",
          sql: "select 1",
          params: 0,
          request: 1,
          tx: 1,
          paramHash: "aaa",
        }),
      ].join("\n"),
    );
    await writeFile(
      sqlPath,
      [
        JSON.stringify({
          kind: "stmt",
          label: "t",
          sql: "BEGIN IMMEDIATE",
          bindCount: 0,
          durationMs: 0.1,
          rows: 0,
          inLock: true,
          failed: false,
        }),
        JSON.stringify({
          kind: "stmt",
          label: "t",
          sql: "select id from docs where id = ?",
          bindCount: 1,
          durationMs: 1.5,
          rows: 1,
          inLock: true,
          failed: false,
        }),
        JSON.stringify({
          kind: "stmt",
          label: "t",
          sql: "COMMIT",
          bindCount: 0,
          durationMs: 0.2,
          rows: 0,
          inLock: true,
          failed: false,
        }),
      ].join("\n"),
    );

    const fullPath = join(dir, "canaries-full.json");
    await writeFile(
      fullPath,
      JSON.stringify({
        schemaVersion: 2,
        scenario: "request-volume-canaries",
        runId: "r1",
        startedAt: "2026-11-27T00:00:00.000Z",
        updatedAt: "2026-11-27T00:01:00.000Z",
        status: "complete",
        revision: "53819b364",
        dirty: false,
        runtime: { bun: "1.4.3", platform: "darwin", arch: "arm64", cpu: "M2" },
        options: {
          canaries: [],
          samples: 1,
          statements: true,
          paramHash: true,
          clientStatements: true,
          payloadAudit: true,
        },
        boundary: "test",
        summary: [],
        runs: [
          {
            canary: "AlphaCanary",
            file: "a.test.tsx",
            sample: 1,
            status: "passed",
            exitCode: 0,
            wallMs: 1200,
            tests: { pass: 1, fail: 0 },
            log: "a.log",
            phases: [
              {
                label: "p1",
                total: 5,
                bodyBytes: { request: 100, response: 200 },
                ws: { total: 2, bytes: 80, byType: {} },
              },
            ],
            statements: {
              status: "captured",
              capture: stmtPath,
              perPhase: [2],
            },
            clientSql: {
              status: "captured",
              capture: sqlPath,
              summary: {
                label: "total",
                statements: 3,
                inLockStatements: 3,
                durationMs: 1.8,
                mutations: 1,
                maxMutationHoldMs: 1.8,
                maxMutationWaitMs: 0.4,
                maxStatementsPerMutation: 3,
                avgStatementsPerMutation: 3,
                truncated: false,
                phases: [],
                top: [
                  {
                    sql: "select id from docs where id = ?",
                    count: 1,
                    durationMs: 1.5,
                  },
                ],
              },
            },
            payloadAudit: {
              status: "captured",
              capture: "p.jsonl",
              summary: {
                requests: 5,
                requestBytes: 100,
                responseBytes: 200,
                echoBytes: 10,
                redeliveredBytes: 20,
                reDownloadedUploadBytes: 5,
                manifestCitations: 3,
                exactHeadRereadsCount: 1,
                byPane: [],
                byRoute: [],
                exactHeadRereads: [],
                topIssuers: [],
              },
            },
          },
          {
            canary: "OfflineCanary",
            file: "offline.test.tsx",
            sample: 1,
            status: "passed",
            exitCode: 0,
            wallMs: 300,
            tests: { pass: 1, fail: 0 },
            log: "o.log",
            phases: [{ label: "offline", total: 0 }],
            statements: {
              status: "captured",
              capture: stmtPath,
              perPhase: [0],
            },
            clientSql: {
              status: "captured",
              capture: sqlPath,
              summary: {
                label: "total",
                statements: 3,
                inLockStatements: 3,
                durationMs: 1.8,
                mutations: 1,
                maxMutationHoldMs: 1.8,
                maxMutationWaitMs: 0.4,
                maxStatementsPerMutation: 3,
                avgStatementsPerMutation: 3,
                truncated: false,
                phases: [],
                top: [],
              },
            },
            payloadAudit: { status: "missing", capture: "offline.jsonl" },
          },
        ],
      }),
    );

    const extracted = await extractCanariesMetrics(fullPath);
    expect(extracted.metrics.requests).toBe(5);
    expect(extracted.metrics.redundantBytes).toBe(35);
    expect(extracted.metrics.byCanary[1]?.requests).toBe(0);
    expect(extracted.metrics.apiStatements).toBe(4);
    expect(extracted.metrics.apiPureReadRepeats).toBe(2);
    expect(extracted.metrics.clientSqlStatements).toBe(6);
    expect(extracted.metrics.clientSqlTxControls).toBe(4);
    expect(extracted.metrics.wsHints).toBe(2);

    const partialPath = join(dir, "canaries-partial.json");
    await writeFile(
      partialPath,
      JSON.stringify({
        schemaVersion: 2,
        scenario: "request-volume-canaries",
        runId: "r2",
        startedAt: "2026-11-27T00:00:00.000Z",
        updatedAt: "2026-11-27T00:01:00.000Z",
        status: "complete",
        revision: "53819b364",
        dirty: false,
        runtime: { bun: "1.4.3", platform: "darwin", arch: "arm64", cpu: "M2" },
        options: {
          canaries: [],
          samples: 1,
          statements: false,
          paramHash: false,
        },
        boundary: "test",
        summary: [],
        runs: [
          {
            canary: "AlphaCanary",
            file: "a.test.tsx",
            sample: 1,
            status: "passed",
            exitCode: 0,
            wallMs: 500,
            tests: { pass: 1, fail: 0 },
            log: "a.log",
            phases: [],
            statements: { status: "off" },
          },
        ],
      }),
    );
    const partial = await extractCanariesMetrics(partialPath);
    expect(partial.metrics.requests).toBeNull();
    expect(partial.metrics.apiStatements).toBeNull();
    expect(partial.metrics.clientSqlStatements).toBeNull();

    const missingWithRequestsPath = join(dir, "canaries-missing-nonzero.json");
    await writeFile(
      missingWithRequestsPath,
      JSON.stringify({
        schemaVersion: 2,
        scenario: "request-volume-canaries",
        runId: "r2b",
        startedAt: "2026-11-27T00:00:00.000Z",
        updatedAt: "2026-11-27T00:01:00.000Z",
        status: "complete",
        revision: "53819b364",
        dirty: false,
        runtime: { bun: "1.4.3", platform: "darwin", arch: "arm64", cpu: "M2" },
        options: {
          canaries: [],
          samples: 1,
          statements: false,
          paramHash: false,
          payloadAudit: true,
        },
        boundary: "test",
        summary: [],
        runs: [
          {
            canary: "ActiveCanary",
            file: "a.test.tsx",
            sample: 1,
            status: "passed",
            exitCode: 0,
            wallMs: 500,
            tests: { pass: 1, fail: 0 },
            log: "a.log",
            phases: [{ label: "p1", total: 3 }],
            statements: { status: "off" },
            payloadAudit: { status: "missing", capture: "missing.jsonl" },
          },
        ],
      }),
    );
    const missingNonZero = await extractCanariesMetrics(
      missingWithRequestsPath,
    );
    expect(missingNonZero.metrics.requests).toBeNull();

    // Unmatched statements, truncated statements, and missing raw clientSql yield null.
    const truncStmtPath = join(dir, "trunc.statements.jsonl");
    await writeFile(
      truncStmtPath,
      [
        JSON.stringify({ label: "t", sql: "select 1", params: 0 }),
        JSON.stringify({ truncated: 1 }),
      ].join("\n"),
    );
    const incompletePath = join(dir, "canaries-incomplete.json");
    await writeFile(
      incompletePath,
      JSON.stringify({
        schemaVersion: 2,
        scenario: "request-volume-canaries",
        runId: "r2c",
        startedAt: "2026-11-27T00:00:00.000Z",
        updatedAt: "2026-11-27T00:01:00.000Z",
        status: "complete",
        revision: "53819b364",
        dirty: false,
        runtime: { bun: "1.4.3", platform: "darwin", arch: "arm64", cpu: "M2" },
        options: {
          canaries: [],
          samples: 1,
          statements: true,
          paramHash: true,
          clientStatements: true,
        },
        boundary: "test",
        summary: [],
        runs: [
          {
            canary: "TruncCanary",
            file: "t.test.tsx",
            sample: 1,
            status: "passed",
            exitCode: 0,
            wallMs: 100,
            tests: { pass: 1, fail: 0 },
            log: "t.log",
            phases: [{ label: "p1", total: 1 }],
            statements: {
              status: "captured",
              capture: truncStmtPath,
              perPhase: [1],
            },
            clientSql: {
              status: "captured",
              capture: join(dir, "nonexistent-client-sql.jsonl"),
              summary: {
                label: "total",
                statements: 10,
                inLockStatements: 5,
                durationMs: 2,
                mutations: 1,
                maxMutationHoldMs: 1,
                maxMutationWaitMs: 0,
                maxStatementsPerMutation: 5,
                avgStatementsPerMutation: 5,
                truncated: false,
                phases: [],
                top: [{ sql: "BEGIN IMMEDIATE", count: 1, durationMs: 0.1 }],
              },
            },
          },
          {
            canary: "UnmatchedCanary",
            file: "u.test.tsx",
            sample: 1,
            status: "passed",
            exitCode: 0,
            wallMs: 100,
            tests: { pass: 1, fail: 0 },
            log: "u.log",
            phases: [{ label: "p1", total: 1 }],
            statements: { status: "unmatched", capture: stmtPath },
          },
        ],
      }),
    );
    const incomplete = await extractCanariesMetrics(incompletePath);
    expect(incomplete.metrics.apiStatements).toBeNull();
    expect(incomplete.metrics.clientSqlTxControls).toBeNull();
    expect(incomplete.metrics.byCanary[0]?.apiStatements).toBeNull();
    expect(incomplete.metrics.byCanary[1]?.apiStatements).toBeNull();

    const failedPath = join(dir, "canaries-failed.json");
    await writeFile(
      failedPath,
      JSON.stringify({
        schemaVersion: 2,
        scenario: "request-volume-canaries",
        runId: "r3",
        status: "failed",
        options: {
          canaries: [],
          samples: 1,
          statements: false,
          paramHash: false,
        },
        summary: [],
        runs: [],
      }),
    );
    await expect(extractCanariesMetrics(failedPath)).rejects.toThrow(/failed/u);
  });
});
