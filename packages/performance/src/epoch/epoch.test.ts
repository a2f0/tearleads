import { describe, expect, test } from "bun:test";
import { compareSnapshots } from "./analyze";
import {
  formatComparisonMarkdown,
  formatEpochTrendsMarkdown,
  formatResultsIndexMarkdown,
} from "./markdown";
import { parseEpochOptions } from "./options";
import {
  CURRENT_EPOCH,
  EPOCH_SCHEMA_VERSION,
  type EpochManifest,
  type EpochSnapshot,
} from "./schema";

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
    expect(() =>
      parseEpochOptions(["record", "--id", "a", "--label", "b", "--json"]),
    ).toThrow(/Unknown option: --json/u);
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
      "### `000-baseline` -> `002-no-plans`\n\nA | B C.",
    );
    expect(trends).toContain(
      "| Plans | Postgres generic Sort plans | 3 queries | — | — | n/a |",
    );
    // Multi-tier scorecard must render paired values (tier 100: 9 -> 3), not max-tier 4.
    const multiTierTrends = formatEpochTrendsMarkdown(
      {
        ...manifest,
        entries: [
          manifest.entries[0] ?? {
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
            id: after.id,
            seq: 1,
            label: after.label,
            kind: "checkpoint",
            recordedAt: after.recordedAt,
            revision: after.revision,
            dirty: false,
            issues: [],
            snapshotFile: "snapshots/001-api-memo.json",
          },
        ],
      },
      [before, after],
    );
    expect(multiTierTrends).toContain(
      "| Realtime | Realtime hub auth statements | 9 stmts | 3 stmts | -6 (-66.7%) | improved |",
    );
    expect(multiTierTrends).toContain("\n**Tradeoffs:**\n\n- **");
    expect(formatResultsIndexMarkdown(manifest, [before])).toContain(
      "# Performance results",
    );
  });

  test("aligns canary/scenario comparisons on shared names and tie-breaks reload/baseline tiers", () => {
    const makeCanary = (
      canary: string,
      requests: number,
      apiStatements: number,
    ) => ({
      canary,
      wallMs: 100,
      requests,
      requestBytes: requests * 10,
      responseBytes: requests * 20,
      redundantBytes: requests * 2,
      exactHeadRereads: 1,
      apiStatements,
      apiTxStatements: apiStatements - 10,
      apiPureReadRepeats: 2,
      clientSqlStatements: requests * 10,
      clientSqlMaxHoldMs: 10,
    });
    const makeScenario = (scenario: string, requests: number) => ({
      scenario,
      wallMs: 100,
      requests,
      conflicts: 0,
      requestBytes: 100,
      responseBytes: 100,
      apiStatements: requests * 5,
      pureReadRepeats: 5,
      clientSqlStatements: 80,
    });
    const baseCanaries = sampleSnapshot().canaries;
    if (!baseCanaries) throw new Error("expected sample canaries");
    const reload = [
      {
        documents: 100,
        folders: 5,
        reload: "settled",
        medianRequests: 8,
        medianSettledMs: 20,
        medianApiStatements: 40,
        medianClientStatements: 80,
      },
      {
        documents: 100,
        folders: 10,
        reload: "settled",
        medianRequests: 6,
        medianSettledMs: 20,
        medianApiStatements: 30,
        medianClientStatements: 60,
      },
    ];
    const baselines = [
      {
        phase: "first-unlink-rotate",
        sizeMiB: 5,
        race: false,
        baselineMode: "inline",
        medianWallMs: 100,
        medianRequests: 4,
        maxConflicts: 0,
        medianPgStatements: 90,
        medianLocalSqlCalls: 100,
        peakRssDeltaMiB: 10,
      },
      {
        phase: "first-unlink-rotate",
        sizeMiB: 5,
        race: true,
        baselineMode: "inline",
        medianWallMs: 100,
        medianRequests: 4,
        maxConflicts: 0,
        medianPgStatements: 120,
        medianLocalSqlCalls: 100,
        peakRssDeltaMiB: 10,
      },
    ];
    const base = sampleSnapshot({
      canaries: {
        ...baseCanaries,
        canaryCount: 2,
        requests: 30,
        apiLockHoldStatements: 200,
        byCanary: [makeCanary("Alpha", 10, 50), makeCanary("Beta", 20, 60)],
      },
      scenarios: {
        scenarioCount: 1,
        wallMs: 100,
        requests: 10,
        conflicts: 0,
        requestBytes: 100,
        responseBytes: 100,
        apiStatements: 50,
        pureReadRepeats: 5,
        clientSqlStatements: 80,
        byScenario: [makeScenario("s1", 10)],
      },
      reload,
      baselines,
    });
    const next = sampleSnapshot({
      id: "001-subset",
      canaries: {
        ...baseCanaries,
        canaryCount: 1,
        requests: 8,
        apiLockHoldStatements: 50,
        byCanary: [makeCanary("Alpha", 8, 40)],
      },
      scenarios: {
        scenarioCount: 2,
        wallMs: 200,
        requests: 25,
        conflicts: 0,
        requestBytes: 200,
        responseBytes: 200,
        apiStatements: 140,
        pureReadRepeats: 12,
        clientSqlStatements: 180,
        byScenario: [makeScenario("s1", 9), makeScenario("s2-new", 16)],
      },
      reload,
      baselines,
    });
    const diff = compareSnapshots(base, next);
    expect(
      diff.metrics.find((m) => m.key === "canaries.requests"),
    ).toMatchObject({ before: 10, after: 8 });
    expect(
      diff.metrics.find((m) => m.key === "canaries.apiLockHoldStatements"),
    ).toBeUndefined();
    expect(
      diff.metrics.find((m) => m.key === "scenarios.requests"),
    ).toMatchObject({ before: 10, after: 9 });
    expect(
      diff.metrics.find((m) => m.key === "reload.settled.requests")?.before,
    ).toBe(6);
    expect(
      diff.metrics.find((m) => m.key === "baselines.firstUnlink.pgStatements")
        ?.before,
    ).toBe(120);
  });
});
