import { expect, test } from "bun:test";
import { emptyTraffic } from "../postgresWire";
import type { ContentionMeasurement } from "./measureContention";
import { formatContention, summarizeContention } from "./summary";

function measurement(
  overrides: Partial<ContentionMeasurement> & {
    readonly maxMs?: number;
    readonly cpuMs?: number;
  },
): ContentionMeasurement {
  const { maxMs = 1, cpuMs = 10, ...rest } = overrides;
  return {
    pass: "declaration",
    size: 1_000,
    sockets: 2,
    sample: 1,
    durationMs: 100,
    authorizationMs: [80, 90],
    hints: {
      intervalMs: 10,
      sent: 10,
      delivered: 10,
      p50Ms: 0.5,
      p95Ms: maxMs,
      p99Ms: maxMs,
      maxMs,
      blockedMs: Math.max(0, maxMs - 10),
    },
    database: { ...emptyTraffic(), bytesReturned: 2_097_152 },
    resources: {
      cpuMs,
      cpuUserMs: cpuMs,
      peakHeapDeltaBytes: 1_048_576,
      peakHeapBytes: 0,
      peakRssDeltaBytes: 0,
      peakRssBytes: 0,
      samples: 1,
    },
    ...rest,
  };
}

test("groups by pass, size and sockets, keeping the worst stall", () => {
  const summary = summarizeContention([
    measurement({ sample: 1, maxMs: 40, cpuMs: 10 }),
    measurement({
      sample: 2,
      maxMs: 120,
      cpuMs: 30,
      authorizationMs: [70, 95],
    }),
    measurement({ sample: 3, maxMs: 60, cpuMs: 20 }),
    measurement({ pass: "revalidation", sockets: 4 }),
  ]);
  expect(summary).toHaveLength(2);
  expect(summary[0]).toMatchObject({
    pass: "declaration",
    sockets: 2,
    samples: 3,
    medianSlowestAuthorizationMs: 90,
    medianHintP99Ms: 60,
    maxHintLagMs: 120,
    medianBlockedMs: 50,
    medianCpuMs: 20,
  });
  expect(summary[1]).toMatchObject({ pass: "revalidation", sockets: 4 });
});

test("a row names the sockets, the pass and the hint lag", () => {
  expect(formatContention(measurement({ maxMs: 42 }))).toBe(
    "2 × 1000 folders, declaration #1, 100 ms, hint lag p50 0.5 ms, p99 42 ms, max 42 ms, 10/10 hints, 10 ms CPU, 1.0 MiB peak heap",
  );
  expect(
    formatContention(measurement({ pass: "idle", size: 0, sockets: 0 })),
  ).toMatch(/^idle hub, idle #1/);
});
