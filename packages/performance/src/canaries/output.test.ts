import { expect, test } from "bun:test";
import { parseCanaryOutput } from "./output";

const metrics = (label: string, total: number, extra = {}) =>
  `[dual-pane-request-metrics] ${JSON.stringify({
    label,
    total,
    bodyBytes: { request: 10 * total, response: 20 * total },
    syncIntents: { readOnly: 1, writeBearing: 0 },
    byRequest: {
      "GET /principals/history": {
        count: total,
        bodyBytes: { request: 0, response: 20 * total },
      },
    },
    ...extra,
  })}`;

test("reads each phase with its repeated paths and the closing tally", () => {
  const output = [
    "src/shell/pane/tests/GroupMutationRequestVolume.test.tsx:",
    metrics("create group", 2),
    "[dual-pane-request-profile] create group total=2",
    "  2 GET /principals/history statuses=200:2",
    "[dual-pane-request-profile-detail] create group repeated-paths",
    "  2 GET /principals/history?ifVersion=2",
    "  2 GET /containers/d6d9c911/writer-projection",
    metrics("add member", 1),
    "[dual-pane-request-profile-detail] add member repeated-paths",
    "(no repeated exact paths)",
    "",
    " 1 pass",
    " 0 fail",
    "Ran 1 test across 1 file. [35.35s]",
  ].join("\n");
  const parsed = parseCanaryOutput(output);
  expect(parsed.tests).toEqual({ pass: 1, fail: 0 });
  expect(parsed.phases.map((phase) => phase.label)).toEqual([
    "create group",
    "add member",
  ]);
  expect(parsed.phases[0]).toEqual({
    label: "create group",
    total: 2,
    bodyBytes: { request: 20, response: 40 },
    syncIntents: { readOnly: 1, writeBearing: 0 },
    byRequest: {
      "GET /principals/history": {
        count: 2,
        bodyBytes: { request: 0, response: 40 },
      },
    },
    repeatedPaths: [
      { count: 2, request: "GET /principals/history?ifVersion=2" },
      { count: 2, request: "GET /containers/d6d9c911/writer-projection" },
    ],
  });
  expect(parsed.phases[1]?.repeatedPaths).toEqual([]);
});

test("ignores a detail block that belongs to no preceding phase", () => {
  const parsed = parseCanaryOutput(
    [
      metrics("first", 1),
      "[dual-pane-request-profile-detail] other repeated-paths",
      "  2 GET /principals/history",
    ].join("\n"),
  );
  expect(parsed.phases[0]?.repeatedPaths).toEqual([]);
  expect(parsed.tests).toBeNull();
});

test("finds metrics after a prefix and refuses malformed counts", () => {
  expect(
    parseCanaryOutput(`stdout | ${metrics("prefixed", 3)}`).phases[0]?.total,
  ).toBe(3);
  expect(() => parseCanaryOutput(metrics("bad", -1))).toThrow(/total/);
  expect(() =>
    parseCanaryOutput(metrics("bad", 1, { byRequest: { x: { count: 1 } } })),
  ).toThrow(/bodyBytes/);
  expect(() =>
    parseCanaryOutput('[dual-pane-request-metrics] {"total":1}'),
  ).toThrow(/label/);
});

test("uses the last tally when a file prints more than one", () => {
  expect(parseCanaryOutput(" 1 pass\n 0 fail\n 3 pass\n 1 fail").tests).toEqual(
    { pass: 3, fail: 1 },
  );
});
