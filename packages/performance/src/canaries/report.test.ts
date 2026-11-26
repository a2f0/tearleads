import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { loadCanaryReport } from "./report";

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

const report = {
  schemaVersion: 1,
  scenario: "request-volume-canaries",
  runId: "run",
  status: "complete",
  summary: [],
  runs: [],
};

test("a complete report loads", async () => {
  const loaded = await loadCanaryReport(await saved(report));
  expect(loaded.runId).toBe("run");
});

test("another scenario's report is refused", async () => {
  const path = await saved({ ...report, scenario: "realtime-interest" });
  await expect(loadCanaryReport(path)).rejects.toThrow(
    "is not a request-volume canary report",
  );
});

test("a report that did not complete is refused", async () => {
  for (const status of ["running", "failed"]) {
    const path = await saved({ ...report, status });
    await expect(loadCanaryReport(path)).rejects.toThrow(
      `is a ${status} report; compare only complete ones.`,
    );
  }
});
