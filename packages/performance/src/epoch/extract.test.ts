import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractCanariesMetrics, extractInventoryMetrics } from "./extract";
import {
  extractBaselineMetrics,
  extractPlansMetrics,
  extractRealtimeMetrics,
  extractReloadMetrics,
  extractRotationMetrics,
  extractScenariosMetrics,
} from "./extractProbes";

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
        ],
      }),
    );

    const extracted = await extractCanariesMetrics(fullPath);
    expect(extracted.metrics.requests).toBe(5);
    expect(extracted.metrics.redundantBytes).toBe(35);
    expect(extracted.metrics.apiStatements).toBe(2);
    expect(extracted.metrics.apiPureReadRepeats).toBe(1);
    expect(extracted.metrics.clientSqlStatements).toBe(3);
    expect(extracted.metrics.clientSqlTxControls).toBe(2);
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

describe("extractInventoryMetrics and probe extractors", () => {
  test("extracts inventory, scenarios, plans, reload, realtime, rotations, and baselines", async () => {
    const dir = await makeTempDir();
    const invPath = join(dir, "inv.json");
    await writeFile(
      invPath,
      JSON.stringify({
        schemaVersion: 1,
        scenario: "static-inventory",
        generatedAt: "2026-11-27T00:00:00Z",
        revision: "abc",
        dirty: false,
        postgres: {
          tableCount: 10,
          columnCount: 50,
          indexCount: 20,
          migrationCount: 2,
          duplicateIndexes: [],
          unreadTables: [],
          unreadColumns: [],
        },
        sqlite: {
          totalTableCount: 12,
          sdkTableCount: 10,
          appProjectionTableCount: 2,
          columnCount: 40,
          indexCount: 15,
          duplicateIndexes: [],
          unreadTables: [],
          unreadColumns: [],
        },
        openapi: {
          pathCount: 5,
          operationCount: 6,
          byMethod: { GET: 6 },
          distinctResponseFields: 30,
          unreadResponseFields: [{ field: "deadField", routes: ["GET /x"] }],
        },
        canaries: {
          budgetAssertionCount: 4,
          ceilingDrift: [
            {
              canary: "C",
              phase: "p",
              measuredTotal: 4,
              ceilingTotal: 7,
              headroom: 3,
            },
          ],
        },
      }),
    );
    const inv = await extractInventoryMetrics(invPath);
    expect(inv.openapi.unreadFields).toEqual(["deadField"]);
    expect(inv.canaries.maxHeadroom).toBe(3);

    const scenPath = join(dir, "scen.json");
    await writeFile(
      scenPath,
      JSON.stringify({
        schemaVersion: 1,
        scenario: "bob-and-alice-scenarios",
        runId: "s1",
        revision: "abc",
        status: "complete",
        runs: [],
        summary: [
          {
            scenario: "alpha",
            samples: 1,
            wallMs: { min: 100, max: 100 },
            requests: { min: 10, max: 10 },
            conflicts: { min: 1, max: 1 },
            requestBytes: { min: 500, max: 500 },
            responseBytes: { min: 700, max: 700 },
            serverMs: { min: 20, max: 20 },
            manifestCitations: { min: 2, max: 2 },
            apiStatements: { min: 50, max: 50 },
            pureReadRepeats: null,
            clientStatements: { min: 120, max: 120 },
            byRoute: {},
            operations: {},
            errorCodes: {},
          },
        ],
      }),
    );
    const scen = await extractScenariosMetrics(scenPath);
    expect(scen.apiStatements).toBe(50);
    expect(scen.pureReadRepeats).toBeNull();

    const reloadPath = join(dir, "reload.json");
    await writeFile(
      reloadPath,
      JSON.stringify({
        scenario: "document-reload",
        status: "complete",
        summary: [
          {
            documents: 100,
            folders: 10,
            reload: "settled",
            medianRequests: 4,
            medianSettledMs: 120.44,
            medianStatements: 55,
            medianLocalStatements: 300,
          },
        ],
      }),
    );
    expect(await extractReloadMetrics(reloadPath)).toEqual([
      {
        documents: 100,
        folders: 10,
        reload: "settled",
        medianRequests: 4,
        medianSettledMs: 120.4,
        medianApiStatements: 55,
        medianClientStatements: 300,
      },
    ]);

    const rtPath = join(dir, "rt.json");
    await writeFile(
      rtPath,
      JSON.stringify({
        scenario: "realtime-container-interest",
        status: "complete",
        summary: [
          {
            size: 100,
            pass: "declaration",
            medianDurationMs: 25.12,
            medianCpuMs: 15.22,
            statements: 9,
            roundTrips: 9,
            rows: 113,
            bytesReturned: 1_000_000,
          },
        ],
      }),
    );
    expect((await extractRealtimeMetrics(rtPath))[0]?.statements).toBe(9);

    const rotPath = join(dir, "rot.json");
    await writeFile(
      rotPath,
      JSON.stringify({
        scenario: "key-rotations",
        status: "complete",
        summary: [
          {
            phase: "group-shrink",
            rotations: 4,
            depth: 3,
            medianWallMs: 800,
            medianRequests: 12,
            maxConflicts: 1,
            medianPgStatements: 400,
            medianLocalSqlCalls: 1200,
          },
        ],
      }),
    );
    expect((await extractRotationMetrics(rotPath))[0]?.medianPgStatements).toBe(
      400,
    );

    const basePath = join(dir, "base.json");
    await writeFile(
      basePath,
      JSON.stringify({
        scenario: "rotation-baselines",
        status: "complete",
        summary: [
          {
            phase: "first-unlink-rotate",
            sizeMiB: 5,
            race: false,
            baselineMode: "inline",
            medianWallMs: 900,
            medianRequests: 6,
            maxConflicts: 0,
            medianPgStatements: 150,
            medianLocalSqlCalls: 500,
            peakRssDeltaMiB: 42.34,
          },
        ],
      }),
    );
    expect((await extractBaselineMetrics(basePath))[0]?.peakRssDeltaMiB).toBe(
      42.3,
    );

    const badPlans = join(dir, "bad-plans.json");
    await writeFile(badPlans, JSON.stringify({ scenario: "other" }));
    await expect(extractPlansMetrics(badPlans)).rejects.toThrow(
      /not a valid perf:plans/u,
    );
    const badReload = join(dir, "bad-reload.json");
    await writeFile(
      badReload,
      JSON.stringify({
        scenario: "document-reload",
        status: "failed",
        summary: [],
      }),
    );
    await expect(extractReloadMetrics(badReload)).rejects.toThrow(/failed/u);
  });
});
