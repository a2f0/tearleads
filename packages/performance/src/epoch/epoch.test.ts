import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareSnapshots } from "./analyze";
import { runEpochCommand } from "./command";
import {
  formatComparisonMarkdown,
  formatEpochTrendsMarkdown,
  formatResultsIndexMarkdown,
} from "./markdown";
import { epochUsage, parseEpochOptions } from "./options";
import {
  CURRENT_EPOCH,
  EPOCH_SCHEMA_VERSION,
  type EpochManifest,
  type EpochSnapshot,
} from "./schema";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tearleads-epoch-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

function sampleSnapshot(overrides: Partial<EpochSnapshot> = {}): EpochSnapshot {
  return {
    schemaVersion: EPOCH_SCHEMA_VERSION,
    epoch: CURRENT_EPOCH,
    id: "000-baseline",
    label: "Initial baseline",
    kind: "baseline",
    recordedAt: "2026-11-27T22:00:00.000Z",
    revision: "53819b364768ac87e42c4fe48c5d41e7b8ad1ec9",
    dirty: false,
    issues: [3396],
    runtime: { bun: "1.4.3", platform: "darwin", arch: "arm64", cpu: "M2 Pro" },
    inventory: {
      postgres: {
        tables: 57,
        columns: 572,
        indexes: 183,
        migrations: 17,
        duplicateIndexes: 0,
        unreadTables: 0,
        unreadColumns: 0,
      },
      sqlite: {
        totalTables: 62,
        sdkTables: 57,
        appProjectionTables: 5,
        columns: 468,
        indexes: 97,
        duplicateIndexes: 0,
        unreadTables: 0,
        unreadColumns: 0,
      },
      openapi: {
        paths: 94,
        operations: 99,
        distinctResponseFields: 405,
        unreadResponseFieldLeads: 3,
        unreadFields: ["leaseExpiresAt", "portalUrl", "stagedBytes"],
      },
      canaries: {
        budgetAssertions: 20,
        driftedPhases: 6,
        maxHeadroom: 13,
        totalHeadroom: 24,
      },
    },
    canaries: {
      canaryCount: 9,
      wallMs: 140_000,
      requests: 340,
      requestBytes: 1_600_000,
      responseBytes: 1_500_000,
      redundantBytes: 200_000,
      echoBytes: 17_000,
      redeliveredBytes: 160_000,
      reDownloadedUploadBytes: 23_000,
      exactHeadRereads: 42,
      manifestCitations: 1000,
      wsHints: 15,
      apiStatements: 36_000,
      apiTxStatements: 30_000,
      apiLockHoldStatements: 22_000,
      apiSameKeyRepeats: 4_800,
      apiPureReadRepeats: 4_200,
      clientSqlStatements: 130_000,
      clientSqlInLock: 81_000,
      clientSqlDurationMs: 13_000,
      clientSqlMutations: 18_000,
      clientSqlTxControls: 31_000,
      clientSqlMaxHoldMs: 60,
      clientSqlMaxWaitMs: 34,
      topApiRoutes: [],
      topClientQueries: [],
      byCanary: [],
    },
    plans: {
      inspected: 25,
      planned: 23,
      skipped: 2,
      seqScanQueries: 0,
      sortQueries: 3,
      materializeQueries: 1,
      flagged: [],
    },
    ...overrides,
  };
}

describe("parseEpochOptions", () => {
  test("parses record, analyze, and render options and rejects malformed integers", () => {
    expect(parseEpochOptions(["--help"])).toBeNull();
    expect(
      parseEpochOptions([
        "record",
        "--id",
        "000-baseline",
        "--label",
        "Clean main",
        "--kind",
        "baseline",
        "--pr",
        "3410",
        "--issues",
        "#3396,3342",
        "--canaries",
        "c.json",
      ]),
    ).toEqual({
      mode: "record",
      id: "000-baseline",
      label: "Clean main",
      kind: "baseline",
      pr: 3410,
      issues: [3342, 3396],
      canaries: "c.json",
    });
    expect(
      parseEpochOptions(["analyze", "--from", "a", "--to", "b", "--json"]),
    ).toEqual({ mode: "analyze", from: "a", to: "b", json: true });
    expect(parseEpochOptions(["render"])).toEqual({ mode: "render" });
    expect(() =>
      parseEpochOptions([
        "record",
        "--id",
        "a",
        "--label",
        "b",
        "--pr",
        "12abc",
      ]),
    ).toThrow(/positive integer/u);
    expect(() =>
      parseEpochOptions([
        "record",
        "--id",
        "a",
        "--label",
        "b",
        "--issues",
        "3396x",
      ]),
    ).toThrow(/Invalid issue number/u);
    expect(() => parseEpochOptions(["bogus"])).toThrow(/Unknown subcommand/u);
  });
});

describe("compareSnapshots", () => {
  test("classifies improvements, regressions, noise thresholds, tradeoffs, and shared tiers", () => {
    const before = sampleSnapshot({
      realtime: [
        {
          size: 100,
          pass: "declaration",
          medianDurationMs: 30,
          medianCpuMs: 20,
          statements: 9,
          roundTrips: 9,
          rows: 113,
          bytesReturned: 1_300_000,
        },
      ],
    });
    const baseCanaries = before.canaries;
    if (!baseCanaries) throw new Error("expected sample canaries");
    const after = sampleSnapshot({
      id: "001-api-memo",
      label: "API | memo\nupdate",
      revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      canaries: {
        ...baseCanaries,
        apiStatements: 30_000,
        apiPureReadRepeats: 800,
        clientSqlDurationMs: 13_400,
        clientSqlStatements: 135_000,
      },
      realtime: [
        {
          size: 100,
          pass: "declaration",
          medianDurationMs: 5,
          medianCpuMs: 3,
          statements: 3,
          roundTrips: 3,
          rows: 4,
          bytesReturned: 20_000,
        },
        {
          size: 10_000,
          pass: "declaration",
          medianDurationMs: 6,
          medianCpuMs: 4,
          statements: 4,
          roundTrips: 4,
          rows: 5,
          bytesReturned: 25_000,
        },
      ],
    });

    const diff = compareSnapshots(before, after);
    expect(diff.improvements.map((m) => m.key)).toEqual([
      "canaries.apiStatements",
      "canaries.apiPureReadRepeats",
      "realtime.declaration.statements",
      "realtime.declaration.bytesReturned",
    ]);
    // Shared tier (size=100) was compared: 9 -> 3, not 9 -> 4 (size=10,000).
    expect(
      diff.metrics.find((m) => m.key === "realtime.declaration.statements")
        ?.after,
    ).toBe(3);
    expect(diff.regressions.map((m) => m.key)).toEqual([
      "canaries.clientSqlStatements",
    ]);
    expect(
      diff.metrics.find((m) => m.key === "canaries.clientSqlDurationMs")
        ?.verdict,
    ).toBe("unchanged");
    expect(diff.tradeoffs.length).toBeGreaterThanOrEqual(1);

    const md = formatComparisonMarkdown(diff);
    expect(md).toContain("## Tradeoffs Detected");

    // Scorecard marks metrics missing from latest as "n/a" (not "baseline") and escapes cells.
    const { plans: _omittedPlans, ...withoutPlans } = sampleSnapshot({
      id: "002-no-plans",
      label: "A | B\nC",
    });
    const latestWithoutPlans: EpochSnapshot = withoutPlans;
    const manifest: EpochManifest = {
      schemaVersion: EPOCH_SCHEMA_VERSION,
      epoch: CURRENT_EPOCH,
      title: "Test",
      startedAt: "2026-11-27T00:00:00Z",
      description: "Desc",
      entries: [
        {
          id: before.id,
          seq: 0,
          label: before.label,
          kind: "baseline",
          recordedAt: before.recordedAt,
          revision: before.revision,
          dirty: false,
          issues: [],
          snapshotFile: "snapshots/000-baseline.json",
        },
        {
          id: latestWithoutPlans.id,
          seq: 1,
          label: latestWithoutPlans.label,
          kind: "checkpoint",
          recordedAt: latestWithoutPlans.recordedAt,
          revision: latestWithoutPlans.revision,
          dirty: false,
          issues: [],
          snapshotFile: "snapshots/002-no-plans.json",
        },
      ],
    };
    const trends = formatEpochTrendsMarkdown(manifest, [
      before,
      latestWithoutPlans,
    ]);
    expect(trends).toContain("A \\| B C");
    expect(trends).toContain(
      "| Plans | Postgres generic Sort plans | 3 queries | — | — | n/a |",
    );
    expect(formatResultsIndexMarkdown(manifest, [before])).toContain(
      "# Performance results",
    );
  });
});

describe("runEpochCommand", () => {
  test("prints usage on --help", async () => {
    const out: string[] = [];
    const code = await runEpochCommand(["--help"], {
      repoRoot: await makeTempDir(),
      resultsDir: await makeTempDir(),
      print: (line) => out.push(line),
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toBe(epochUsage);
  });

  test("records, updates in-place, renders, analyzes, and rejects corrupt manifests", async () => {
    const dir = await makeTempDir();
    const resultsDir = join(dir, "results");
    const makePlans = (sortQueries: number, path: string) =>
      writeFile(
        path,
        JSON.stringify({
          scenario: "postgres-query-plans",
          summary: {
            inspected: 25,
            planned: 23,
            skipped: 2,
            seqScanQueries: 0,
            sortQueries,
            plans:
              sortQueries > 0
                ? [
                    {
                      sql: "select * from t order by x",
                      count: 100,
                      status: "planned",
                      nodeTypes: ["Sort"],
                      warnings: [{ kind: "Sort" }, { kind: "Materialize" }],
                    },
                  ]
                : [],
          },
        }),
      );
    const plans0 = join(dir, "plans-0.json");
    const plans1 = join(dir, "plans-1.json");
    const plans2 = join(dir, "plans-2.json");
    await Promise.all([
      makePlans(3, plans0),
      makePlans(1, plans1),
      makePlans(0, plans2),
    ]);

    const out: string[] = [];
    const host = {
      repoRoot: dir,
      resultsDir,
      print: (line: string) => out.push(line),
    };
    expect(
      await runEpochCommand(
        [
          "record",
          "--id",
          "000-baseline",
          "--label",
          "Base",
          "--kind",
          "baseline",
          "--plans",
          plans0,
        ],
        host,
      ),
    ).toBe(0);
    expect(
      await runEpochCommand(
        ["record", "--id", "001-mid", "--label", "Mid", "--plans", plans1],
        host,
      ),
    ).toBe(0);
    expect(
      await runEpochCommand(
        ["record", "--id", "002-end", "--label", "End", "--plans", plans2],
        host,
      ),
    ).toBe(0);

    // Re-recording 001-mid compares 000-baseline -> 001-mid, not 001-mid -> 002-end.
    const updateOut: string[] = [];
    expect(
      await runEpochCommand(
        [
          "record",
          "--id",
          "001-mid",
          "--label",
          "Mid updated",
          "--plans",
          plans1,
        ],
        { ...host, print: (line) => updateOut.push(line) },
      ),
    ).toBe(0);
    expect(updateOut.join("\n")).toContain("`000-baseline` -> `001-mid`");

    // Render mode regenerates views cleanly.
    const renderOut: string[] = [];
    expect(
      await runEpochCommand(["render"], {
        ...host,
        print: (line) => renderOut.push(line),
      }),
    ).toBe(0);
    expect(renderOut.join("\n")).toContain("3 snapshots");

    const manifest = JSON.parse(
      await readFile(join(resultsDir, "epoch-2/manifest.json"), "utf8"),
    ) as EpochManifest;
    expect(manifest.entries.map((e) => e.id)).toEqual([
      "000-baseline",
      "001-mid",
      "002-end",
    ]);

    // Corrupt manifest must throw instead of silently wiping history.
    const corruptDir = join(dir, "corrupt");
    await mkdir(join(corruptDir, "epoch-2"), { recursive: true });
    await writeFile(join(corruptDir, "epoch-2/manifest.json"), "{bad json");
    await expect(
      runEpochCommand(
        ["record", "--id", "000-base", "--label", "Base", "--plans", plans0],
        { ...host, resultsDir: corruptDir },
      ),
    ).rejects.toThrow();
  });
});
