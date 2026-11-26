import { expect, test } from "bun:test";
import type { PassMeasurement } from "./measurePass";
import { formatMeasurement, summarize } from "./summary";

function measurement(
  overrides: Partial<PassMeasurement> & Pick<PassMeasurement, "pass">,
): PassMeasurement {
  return {
    size: 100,
    sample: 1,
    authorized: 100,
    evicted: 0,
    durationMs: 10,
    authorizationMs: 9,
    authorizationCalls: 1,
    productionBudgetMs: 10_000,
    database: {
      connections: 0,
      statements: 9,
      roundTrips: 9,
      rows: 120,
      bytesSent: 1_000,
      bytesReturned: 2_097_152,
    },
    resources: {
      cpuMs: 8,
      cpuUserMs: 7,
      peakHeapDeltaBytes: 1_048_576,
      peakHeapBytes: 9_000_000,
      peakRssDeltaBytes: 0,
      peakRssBytes: 90_000_000,
      samples: 3,
    },
    ...overrides,
  };
}

test("summarizes medians per size and pass", () => {
  const rows = summarize([
    measurement({ pass: "declaration", durationMs: 30 }),
    measurement({ pass: "revalidation", durationMs: 5 }),
    measurement({ pass: "declaration", sample: 2, durationMs: 10 }),
    measurement({ pass: "declaration", sample: 3, durationMs: 20 }),
  ]);
  expect(
    rows.map((row) => [row.pass, row.samples, row.medianDurationMs]),
  ).toEqual([
    ["declaration", 3, 20],
    ["revalidation", 1, 5],
  ]);
  expect(rows[0]).toMatchObject({ statements: 9, bytesReturned: 2_097_152 });
});

test("flags a pass slower than the production budget", () => {
  const row = formatMeasurement(
    measurement({ pass: "declaration", durationMs: 12_000 }),
  );
  expect(row).toContain("2.0 MiB returned");
  expect(row).toContain("over the 10 s budget");
  expect(
    formatMeasurement(measurement({ pass: "revalidation" })),
  ).not.toContain("budget");
});
