import { expect, test } from "bun:test";
import { emptyHttpTraffic } from "../inProcess/httpCounterProxy";
import { emptyTraffic } from "../inProcess/postgresWire";
import type { BaselinePhaseMeasurement } from "./runTier";
import {
  formatBaselineLine,
  formatBaselinesMarkdown,
  summarizeBaselines,
} from "./summary";

function measurement(
  overrides: Partial<BaselinePhaseMeasurement> = {},
): BaselinePhaseMeasurement {
  return {
    sizeMiB: 1,
    chunkMiB: 6,
    race: false,
    sample: 1,
    phase: "first-unlink-rotate",
    wallMs: 250,
    http: {
      ...emptyHttpTraffic(),
      requests: 8,
      requestBytes: 2_000_000,
      responseBytes: 5_000,
    },
    database: {
      ...emptyTraffic(),
      statements: 120,
      roundTrips: 120,
      rows: 400,
      bytesSent: 15_000,
      bytesReturned: 30_000,
    },
    localSql: {
      calls: 400,
      durationMs: 35,
      attribution: {
        top: [
          {
            sql: "SELECT * FROM docs",
            count: 2,
            durationMs: 1,
            planFlags: ["SCAN docs"],
          },
        ],
        mutations: 12,
        maxMutationHoldMs: 5,
        maxStatementsPerMutation: 6,
      },
    },
    resources: {
      cpuMs: 200,
      cpuUserMs: 180,
      peakHeapDeltaBytes: 4 * 1024 * 1024,
      peakHeapBytes: 24 * 1024 * 1024,
      peakRssDeltaBytes: 12 * 1024 * 1024,
      peakRssBytes: 128 * 1024 * 1024,
      samples: 5,
    },
    ...overrides,
  };
}

test("summarizes inline and staged baseline phases and formats Markdown", () => {
  const rows = [
    measurement({
      sizeMiB: 1,
      wallMs: 300,
      sample: 1,
      baselineMode: "inline",
      stagedSegments: 0,
      stageResumes: 0,
    }),
    measurement({
      sizeMiB: 1,
      wallMs: 200,
      sample: 2,
      baselineMode: "inline",
      stagedSegments: 0,
      stageResumes: 0,
    }),
    measurement({
      sizeMiB: 13,
      race: true,
      baselineMode: "staged",
      stagedSegments: 4,
      stageResumes: 1,
      wallMs: 4200,
      http: {
        ...emptyHttpTraffic(),
        requests: 22,
        conflicts: 1,
        requestBytes: 18_000_000,
        responseBytes: 20_000,
      },
    }),
    measurement({
      phase: "fresh-reader-sync",
      sizeMiB: 13,
      race: true,
      wallMs: 3100,
    }),
  ];
  const summary = summarizeBaselines(rows);
  expect(summary.map((r) => `${r.phase}:${r.sizeMiB}`)).toEqual([
    "first-unlink-rotate:1",
    "first-unlink-rotate:13",
    "fresh-reader-sync:13",
  ]);
  expect(summary[0]?.medianWallMs).toBe(250);
  expect(summary[0]?.maxPlanWarnings).toBe(1);
  expect(summary[1]?.baselineMode).toBe("staged");
  expect(summary[1]?.maxStagedSegments).toBe(4);
  expect(summary[1]?.maxStageResumes).toBe(1);

  expect(formatBaselineLine(rows[2] ?? measurement())).toContain(
    "13MiB+race #1, first-unlink-rotate [staged, 4 segs, 1 resume], 22 reqs (1 409s)",
  );
  const md = formatBaselinesMarkdown(summary, "Database `probe`.");
  expect(md).toContain("# Rotation baseline scaling");
  expect(md).toContain(
    "| `first-unlink-rotate` | 13 | yes | staged | 4 (+1r) |",
  );
  expect(md).toContain("| `fresh-reader-sync` | 13 | yes | — | — |");
});
