import { expect, test } from "bun:test";
import { emptyHttpTraffic } from "../inProcess/httpCounterProxy";
import { emptyTraffic } from "../inProcess/postgresWire";
import type { RotationPhaseMeasurement } from "./runTier";
import {
  formatRotationLine,
  formatRotationsMarkdown,
  summarizeRotations,
} from "./summary";

function sampleMeasurement(
  overrides: Partial<RotationPhaseMeasurement> = {},
): RotationPhaseMeasurement {
  return {
    rotations: 4,
    depth: 3,
    sample: 1,
    phase: "stale-writer-repair",
    wallMs: 220,
    http: {
      ...emptyHttpTraffic(),
      requests: 7,
      conflicts: 1,
      requestBytes: 4200,
      responseBytes: 9800,
    },
    database: {
      ...emptyTraffic(),
      statements: 95,
      roundTrips: 90,
      bytesReturned: 18_000,
    },
    localSql: {
      calls: 140,
      durationMs: 12,
      attribution: {
        top: [
          {
            sql: "SELECT * FROM docs",
            count: 20,
            durationMs: 4.5,
            planFlags: ["SCAN"],
          },
        ],
        mutations: 3,
        maxMutationHoldMs: 3.1,
        maxStatementsPerMutation: 12,
      },
    },
    resources: {
      cpuMs: 35.4,
      cpuUserMs: 30,
      peakHeapDeltaBytes: 10_000,
      peakHeapBytes: 50_000,
      peakRssDeltaBytes: 20_000,
      peakRssBytes: 100_000,
      samples: 5,
    },
    ...overrides,
  };
}

test("formats terminal rows, medians, and Markdown scaling tables", () => {
  const first = sampleMeasurement({ sample: 1, wallMs: 200 });
  const second = sampleMeasurement({ sample: 2, wallMs: 260 });
  expect(formatRotationLine(first)).toBe(
    "R=4 D=3 #1, stale-writer-repair, 7 reqs (1 409s), 95 pg stmts, 140 local SQL, 200 ms",
  );

  const summary = summarizeRotations([first, second]);
  expect(summary).toHaveLength(1);
  expect(summary[0]).toMatchObject({
    phase: "stale-writer-repair",
    rotations: 4,
    depth: 3,
    samples: 2,
    medianWallMs: 230,
    medianRequests: 7,
    maxConflicts: 1,
    medianPgStatements: 95,
    medianLocalSqlCalls: 140,
    maxPlanWarnings: 1,
  });

  const md = formatRotationsMarkdown(summary, "Database `scratch`.");
  expect(md).toContain("# Key rotation and revocation scaling");
  expect(md).toContain("| `stale-writer-repair` | 4 | 3 | 230 | 7 | 1 |");
});
