import { expect, test } from "bun:test";
import { probeReport } from "./inProcessProbe";

const header = {
  schemaVersion: 1,
  scenario: "document-reload",
  runId: "run",
  startedAt: "2026-11-25T00:00:00.000Z",
  database: "scratch",
  options: {},
  boundary: "local",
  revision: "abc",
  dirty: false,
  runtime: {},
  updatedAt: "2026-11-25T00:00:01.000Z",
  status: "complete",
};

test("a report puts the probe's results after its header", () => {
  const report = probeReport(header, { summary: [], measurements: [1] });
  expect(Object.keys(report).slice(-3)).toEqual([
    "status",
    "summary",
    "measurements",
  ]);
  expect(report).toMatchObject({ measurements: [1] });
});

test("results cannot replace a header field", () => {
  expect(() =>
    probeReport(header, { status: "complete", runId: "other", summary: [] }),
  ).toThrow("Probe results cannot set runId, status.");
});
