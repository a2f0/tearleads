import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { type CanaryReport, type CanaryRun, loadCanaryReport } from "./report";
import { comparePhases, phaseChanged } from "./summary";

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function saved(report: object): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "canary-report-"));
  directories.push(directory);
  const path = resolve(directory, "report.json");
  await writeFile(path, JSON.stringify(report));
  return path;
}

const range = { min: 1, max: 1 };
const phase = {
  canary: "Fake",
  label: "phase",
  occurrence: 0,
  samples: 1,
  requests: range,
  requestBytes: range,
  responseBytes: range,
  byRequest: {},
};
const run: Omit<CanaryRun, "statements"> = {
  canary: "Fake",
  file: "src/Fake.test.tsx",
  sample: 1,
  status: "passed",
  exitCode: 0,
  wallMs: 10,
  tests: { pass: 1, fail: 0 },
  log: "/private/fake.log",
  phases: [],
};
const report: CanaryReport = {
  schemaVersion: 2,
  scenario: "request-volume-canaries",
  runId: "run",
  startedAt: "2026-11-26T00:00:00.000Z",
  updatedAt: "2026-11-26T00:01:00.000Z",
  status: "complete",
  revision: "0123456789abcdef",
  dirty: false,
  runtime: { bun: "1.3.0", platform: "darwin", arch: "arm64", cpu: null },
  options: { canaries: [], samples: 1, statements: true, paramHash: true },
  boundary: "Boundary",
  summary: [{ ...phase, statements: { min: 4, max: 4 } }],
  runs: [
    {
      ...run,
      statements: { status: "captured", capture: "c", perPhase: [4] },
    },
  ],
};
/** As `perf:canaries` saved it before statement capture (#3330). */
const beforeCapture = {
  ...report,
  schemaVersion: 1,
  options: { canaries: [], samples: 1 },
  summary: [phase],
  runs: [run],
};

test("a complete report loads as saved", async () => {
  expect(await loadCanaryReport(await saved(report))).toEqual(report);
});

test("another scenario's report is refused", async () => {
  const path = await saved({ ...report, scenario: "realtime-interest" });
  await expect(loadCanaryReport(path)).rejects.toThrow(
    "is not a request-volume canary report",
  );
  await expect(
    loadCanaryReport(await saved({ ...report, schemaVersion: 3 })),
  ).rejects.toThrow("is not a request-volume canary report");
});

test("a report that did not complete is refused", async () => {
  for (const status of ["running", "failed"]) {
    const path = await saved({ ...report, status });
    await expect(loadCanaryReport(path)).rejects.toThrow(
      `is a ${status} report; compare only complete ones.`,
    );
  }
});

test("a report saved before statement capture loads with every field", async () => {
  expect(await loadCanaryReport(await saved(beforeCapture))).toEqual({
    ...report,
    options: { canaries: [], samples: 1, statements: false, paramHash: false },
    summary: [{ ...phase, statements: null }],
    runs: [{ ...run, statements: { status: "off" } }],
  });
});

test("a version 1 capture names each run's statements state", async () => {
  const loaded = await loadCanaryReport(
    await saved({
      ...beforeCapture,
      options: { canaries: [], samples: 3, statements: true, paramHash: false },
      runs: [
        { ...run, sample: 1, statements: { capture: "a", perPhase: [4] } },
        { ...run, sample: 2, statements: { capture: "b", perPhase: null } },
        { ...run, sample: 3, status: "failed", statements: null },
      ],
    }),
  );
  expect(loaded.schemaVersion).toBe(2);
  expect(loaded.options).toMatchObject({ statements: true, paramHash: false });
  expect(loaded.runs.map((entry) => entry.statements)).toEqual([
    { status: "captured", capture: "a", perPhase: [4] },
    { status: "unmatched", capture: "b" },
    { status: "off" },
  ]);
});

test("a report saved before statement capture compares", async () => {
  const before = await loadCanaryReport(await saved(beforeCapture));
  const [change] = comparePhases(before.summary, report.summary);
  if (!change) throw new Error("No change was compared.");
  expect(phaseChanged(change)).toBe(false);
});
