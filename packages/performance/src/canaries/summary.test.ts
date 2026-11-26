import { expect, test } from "bun:test";
import type { PhaseMetrics } from "./output";
import { comparePhases, phaseChanged, summarizePhases } from "./summary";

function phase(
  label: string,
  counts: Record<string, number>,
  bytes = { request: 100, response: 200 },
): PhaseMetrics {
  return {
    label,
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
    bodyBytes: bytes,
    syncIntents: { readOnly: 0, writeBearing: 0 },
    byRequest: Object.fromEntries(
      Object.entries(counts).map(([request, count]) => [
        request,
        { count, bodyBytes: { request: count, response: 2 * count } },
      ]),
    ),
    repeatedPaths: [],
  };
}

test("ranges each phase across samples and counts a missing endpoint as 0", () => {
  const summary = summarizePhases([
    {
      canary: "Groups",
      phases: [
        phase("create", { "POST /groups": 1, "GET /policy": 2 }),
        phase("create", { "POST /groups": 1 }),
      ],
    },
    {
      canary: "Groups",
      phases: [
        phase("create", { "POST /groups": 1 }, { request: 90, response: 210 }),
        phase("create", { "POST /groups": 1 }),
      ],
    },
  ]);
  expect(summary.map((entry) => [entry.label, entry.occurrence])).toEqual([
    ["create", 0],
    ["create", 1],
  ]);
  expect(summary[0]).toMatchObject({
    canary: "Groups",
    samples: 2,
    requests: { min: 1, max: 3 },
    requestBytes: { min: 90, max: 100 },
    responseBytes: { min: 200, max: 210 },
  });
  expect(summary[0]?.byRequest["GET /policy"]).toEqual({
    count: { min: 0, max: 2 },
    requestBytes: { min: 0, max: 2 },
    responseBytes: { min: 0, max: 4 },
  });
  expect(Object.keys(summary[0]?.byRequest ?? {})).toEqual([
    "GET /policy",
    "POST /groups",
  ]);
});

test("pairs phases by canary, label and occurrence", () => {
  const before = summarizePhases([
    {
      canary: "A",
      phases: [
        phase("same", { "GET /x": 1 }),
        phase("fewer", { "GET /x": 3, "GET /y": 1 }),
        phase("gone", { "GET /x": 1 }),
      ],
    },
  ]);
  const after = summarizePhases([
    {
      canary: "A",
      phases: [
        phase("same", { "GET /x": 1 }),
        phase("fewer", { "GET /x": 2, "GET /y": 1 }),
        phase("new", { "GET /z": 1 }),
      ],
    },
  ]);
  const changes = comparePhases(before, after);
  expect(changes.map((change) => change.label)).toEqual([
    "same",
    "fewer",
    "gone",
    "new",
  ]);
  expect(changes.map(phaseChanged)).toEqual([false, true, true, true]);
  expect(changes[1]?.endpoints).toEqual([
    {
      request: "GET /x",
      before: {
        count: { min: 3, max: 3 },
        requestBytes: { min: 3, max: 3 },
        responseBytes: { min: 6, max: 6 },
      },
      after: {
        count: { min: 2, max: 2 },
        requestBytes: { min: 2, max: 2 },
        responseBytes: { min: 4, max: 4 },
      },
    },
  ]);
  expect(changes[2]?.after).toBeNull();
  expect(changes[3]?.before).toBeNull();
});

test("a byte change alone marks a phase changed", () => {
  const [change] = comparePhases(
    summarizePhases([{ canary: "A", phases: [phase("p", { "GET /x": 1 })] }]),
    summarizePhases([
      {
        canary: "A",
        phases: [phase("p", { "GET /x": 1 }, { request: 100, response: 150 })],
      },
    ]),
  );
  expect(change && phaseChanged(change)).toBe(true);
  expect(change?.endpoints).toEqual([]);
});
