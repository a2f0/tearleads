import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  test("parses record, analyze, and render options", () => {
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
  });

  test("rejects invalid ids and unknown subcommands", () => {
    expect(() => parseEpochOptions(["bogus"])).toThrow(/Unknown subcommand/u);
    expect(() =>
      parseEpochOptions(["record", "--id", "Bad Id", "--label", "x"]),
    ).toThrow(/--id is required/u);
  });
});

describe("compareSnapshots", () => {
  test("classifies improvements, regressions, noise thresholds, and cross-dimension tradeoffs", () => {
    const before = sampleSnapshot();
    const baseCanaries = before.canaries;
    if (!baseCanaries) throw new Error("expected sample canaries");
    const after = sampleSnapshot({
      id: "001-api-memo",
      label: "API read memoization",
      revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      canaries: {
        ...baseCanaries,
        apiStatements: 30_000,
        apiPureReadRepeats: 800,
        // Small noise within 5% threshold should stay unchanged:
        clientSqlDurationMs: 13_400,
        // Deterministic client SQL increase should flag as regression + tradeoff:
        clientSqlStatements: 135_000,
      },
    });

    const diff = compareSnapshots(before, after);
    expect(diff.improvements.map((m) => m.key)).toEqual([
      "canaries.apiStatements",
      "canaries.apiPureReadRepeats",
    ]);
    expect(diff.regressions.map((m) => m.key)).toEqual([
      "canaries.clientSqlStatements",
    ]);
    expect(
      diff.metrics.find((m) => m.key === "canaries.clientSqlDurationMs")
        ?.verdict,
    ).toBe("unchanged");
    expect(diff.tradeoffs).toHaveLength(1);
    expect(diff.tradeoffs[0]).toMatchObject({
      improvedDimension: "API DB",
      regressedDimension: "Client SQLite",
    });

    const md = formatComparisonMarkdown(diff);
    expect(md).toContain("## Tradeoffs Detected");
    expect(md).toContain("API DB");
    expect(md).toContain("Client SQLite");
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

  test("records snapshots from fixture reports, renders TRENDS/README, and analyzes deltas", async () => {
    const dir = await makeTempDir();
    const resultsDir = join(dir, "results");
    const plansBefore = join(dir, "plans-before.json");
    const plansAfter = join(dir, "plans-after.json");
    await writeFile(
      plansBefore,
      JSON.stringify({
        summary: {
          inspected: 25,
          planned: 23,
          skipped: 2,
          seqScanQueries: 0,
          sortQueries: 3,
          plans: [
            {
              sql: "select * from t order by x",
              count: 100,
              status: "planned",
              nodeTypes: ["Sort"],
              warnings: [{ kind: "Sort" }, { kind: "Materialize" }],
            },
          ],
        },
      }),
    );
    await writeFile(
      plansAfter,
      JSON.stringify({
        summary: {
          inspected: 25,
          planned: 25,
          skipped: 0,
          seqScanQueries: 0,
          sortQueries: 0,
          plans: [],
        },
      }),
    );

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
          "Baseline",
          "--kind",
          "baseline",
          "--plans",
          plansBefore,
        ],
        host,
      ),
    ).toBe(0);
    expect(
      await runEpochCommand(
        [
          "record",
          "--id",
          "001-fix-plans",
          "--label",
          "Fix generic plan sorts",
          "--issues",
          "3396",
          "--plans",
          plansAfter,
        ],
        host,
      ),
    ).toBe(0);

    const manifest = JSON.parse(
      await readFile(join(resultsDir, "epoch-2/manifest.json"), "utf8"),
    ) as EpochManifest;
    expect(manifest.entries.map((e) => e.id)).toEqual([
      "000-baseline",
      "001-fix-plans",
    ]);

    const trends = await readFile(
      join(resultsDir, "epoch-2/TRENDS.md"),
      "utf8",
    );
    expect(trends).toContain("## Step-by-Step Deltas & Tradeoffs");
    expect(trends).toContain("001-fix-plans");

    const readme = await readFile(join(resultsDir, "README.md"), "utf8");
    expect(readme).toContain("Epoch 2 Scorecard");

    const analyzeOut: string[] = [];
    expect(
      await runEpochCommand(["analyze", "--json"], {
        ...host,
        print: (line) => analyzeOut.push(line),
      }),
    ).toBe(0);
    const parsed = JSON.parse(analyzeOut.join("\n"));
    expect(parsed.improvements.map((m: { key: string }) => m.key)).toContain(
      "plans.sortQueries",
    );
    expect(formatEpochTrendsMarkdown(manifest, [sampleSnapshot()])).toContain(
      "# Performance Epoch 2",
    );
    expect(formatResultsIndexMarkdown(manifest, [sampleSnapshot()])).toContain(
      "# Performance results",
    );
  });
});
