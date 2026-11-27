import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractInventoryMetrics } from "./extract";
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
  const dir = await mkdtemp(join(tmpdir(), "tearleads-epoch-probes-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("extractInventoryMetrics and probe extractors", () => {
  test("extracts inventory, scenarios, reload, realtime, rotations, and baselines", async () => {
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
  });

  test("rejects incomplete or malformed probe reports", async () => {
    const dir = await makeTempDir();
    const badPlans = join(dir, "bad-plans.json");
    await writeFile(badPlans, JSON.stringify({ scenario: "other" }));
    await expect(extractPlansMetrics(badPlans)).rejects.toThrow(
      /not a valid perf:plans/u,
    );

    const badPlanRow = join(dir, "bad-plan-row.json");
    await writeFile(
      badPlanRow,
      JSON.stringify({
        scenario: "postgres-query-plans",
        summary: {
          inspected: 1,
          planned: 1,
          skipped: 0,
          seqScanQueries: 0,
          sortQueries: 0,
          plans: [{ count: "bad", sql: "select 1", warnings: [] }],
        },
      }),
    );
    await expect(extractPlansMetrics(badPlanRow)).rejects.toThrow(/count/u);

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

    const badRow = join(dir, "bad-rt-row.json");
    await writeFile(
      badRow,
      JSON.stringify({
        scenario: "realtime-container-interest",
        status: "complete",
        summary: [{ size: "not-a-number", pass: "declaration" }],
      }),
    );
    await expect(extractRealtimeMetrics(badRow)).rejects.toThrow(/size/u);
  });
});
