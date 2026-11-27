import { expect, test } from "bun:test";
import type { ScenarioHttpSummary } from "./httpCapture";
import { parseBunTestCounts, scenarioRunStatus } from "./run";

const passingHttp: ScenarioHttpSummary = {
  requests: 5,
  requestBytes: 100,
  responseBytes: 200,
  serverMs: 12,
  conflicts: 0,
  clientErrors: 0,
  manifestCitations: 0,
  truncated: false,
  statuses: { "200": 5 },
  errorCodes: {},
  operations: {},
  byRoute: {},
};

test("parses Bun pass and fail summaries from scenario logs", () => {
  expect(
    parseBunTestCounts("bun test v1.4.3\n\n 2 pass\n 0 fail\nRan 2 tests\n"),
  ).toEqual({ pass: 2, fail: 0 });
  expect(parseBunTestCounts("no summary here")).toBeNull();
});

test("classifies passed, failed, timed-out, and unprofiled scenario runs", () => {
  expect(scenarioRunStatus(0, false, { pass: 1, fail: 0 }, passingHttp)).toBe(
    "passed",
  );
  expect(scenarioRunStatus(null, true, null, null)).toBe("timed-out");
  expect(scenarioRunStatus(1, false, { pass: 0, fail: 1 }, passingHttp)).toBe(
    "failed",
  );
  expect(scenarioRunStatus(0, false, { pass: 1, fail: 0 }, null)).toBe(
    "unprofiled",
  );
  expect(
    scenarioRunStatus(
      0,
      false,
      { pass: 1, fail: 0 },
      { ...passingHttp, requests: 0 },
    ),
  ).toBe("unprofiled");
});
