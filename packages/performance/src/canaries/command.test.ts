import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { type CanaryHost, runCanaryCommand } from "./command";
import type { Canary } from "./discover";
import type { PhaseMetrics } from "./output";
import type { CanaryReport, CanaryRun, CanaryRunStatus } from "./report";
import type { CanaryRunInput } from "./run";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

const phase = (total: number): PhaseMetrics => ({
  label: "phase",
  total,
  bodyBytes: { request: total, response: total },
  syncIntents: { readOnly: 0, writeBearing: 0 },
  byRequest: {},
  repeatedPaths: [],
});

const canaries: Canary[] = [
  { name: "First", file: "src/First.test.tsx" },
  { name: "Second", file: "src/Second.test.tsx" },
];

type Outcome = { status: CanaryRunStatus; total: number };

/**
 * A host whose canaries return `outcomes` in turn, saving to a temporary
 * directory. Each run sees the reports saved before it.
 */
async function fakeHost(outcomes: Outcome[]) {
  const directory = await mkdtemp(resolve(tmpdir(), "canary-command-"));
  directories.push(directory);
  const runs: { input: CanaryRunInput; savedBefore: CanaryReport | null }[] =
    [];
  const printed: string[] = [];
  let discovered = false;
  const host: CanaryHost = {
    discover: async () => {
      discovered = true;
      return canaries;
    },
    runCanary: async (input): Promise<CanaryRun> => {
      const outcome = outcomes[runs.length];
      if (!outcome) throw new Error("No outcome is left for this run.");
      runs.push({ input, savedBefore: await savedReport(directory) });
      await writeFile(input.log, `${input.canary.name} output\n`);
      return {
        canary: input.canary.name,
        file: input.canary.file,
        sample: input.sample,
        status: outcome.status,
        exitCode: outcome.status === "passed" ? 0 : 1,
        wallMs: 1_000,
        tests: { pass: 1, fail: outcome.status === "passed" ? 0 : 1 },
        log: input.log,
        phases: [phase(outcome.total)],
        statements: { status: "off" },
      };
    },
    reportDirectory: directory,
    print: (text) => printed.push(text),
  };
  return {
    host,
    directory,
    runs,
    printed,
    discovered: () => discovered,
  };
}

/** The canary report saved in `directory`, if any. */
async function savedReport(directory: string): Promise<CanaryReport | null> {
  const name = (await readdir(directory)).find((file) =>
    /^canaries-[^/]+\.json$/u.test(file),
  );
  return name
    ? (JSON.parse(
        await readFile(resolve(directory, name), "utf8"),
      ) as CanaryReport)
    : null;
}

test("a run whose canaries all pass is complete, saved as it goes", async () => {
  const fake = await fakeHost([
    { status: "passed", total: 2 },
    { status: "passed", total: 3 },
  ]);
  expect(await runCanaryCommand([], fake.host)).toBe(0);
  expect(fake.runs.map(({ input }) => input.canary.name)).toEqual([
    "First",
    "Second",
  ]);
  expect(fake.runs[0]?.savedBefore).toBeNull();
  // The report is saved, still running, after each run.
  expect(fake.runs[1]?.savedBefore).toMatchObject({
    schemaVersion: 2,
    status: "running",
    runs: [{ canary: "First" }],
  });
  const final = await savedReport(fake.directory);
  expect(final?.status).toBe("complete");
  expect(final?.runs).toHaveLength(2);
  expect(fake.printed.at(-1)).toMatch(/^Report: .*\nMarkdown: .*\.md$/u);
});

test("a run that did not pass fails the report, outside the ranges", async () => {
  const baseline = await fakeHost([
    { status: "passed", total: 2 },
    { status: "passed", total: 2 },
  ]);
  await runCanaryCommand(
    ["--canary", "First", "--samples", "2"],
    baseline.host,
  );
  const baselinePath = (await readdir(baseline.directory)).find((file) =>
    file.endsWith(".json"),
  );
  if (!baselinePath) throw new Error("The baseline was not saved.");
  const fake = await fakeHost([
    { status: "passed", total: 2 },
    { status: "failed", total: 50 },
  ]);
  const args = ["--canary", "First", "--samples", "2", "--baseline"];
  expect(
    await runCanaryCommand(
      [...args, resolve(baseline.directory, baselinePath)],
      fake.host,
    ),
  ).toBe(1);
  const final = await savedReport(fake.directory);
  expect(final?.status).toBe("failed");
  expect(final?.runs.map((run) => run.status)).toEqual(["passed", "failed"]);
  expect(final?.summary.map((entry) => entry.requests)).toEqual([
    { min: 2, max: 2 },
  ]);
  // The failed run's log reaches the terminal, and the comparison says
  // which side did not complete.
  expect(fake.printed).toContain("First output");
  const markdown = await readFile(
    resolve(fake.directory, `canaries-${final?.runId}.md`),
    "utf8",
  );
  expect(markdown).toMatch(/After: run \S+ at [0-9a-f]{12} \(failed\)\./u);
});

test("a baseline that cannot be read stops before any canary runs", async () => {
  const fake = await fakeHost([{ status: "passed", total: 1 }]);
  const missing = resolve(fake.directory, "missing.json");
  await expect(
    runCanaryCommand(["--baseline", missing], fake.host),
  ).rejects.toThrow(/missing\.json/u);
  expect(fake.discovered()).toBe(false);
  expect(fake.runs).toEqual([]);
});

test("the report is saved before a comparison that throws", async () => {
  const fake = await fakeHost([
    { status: "passed", total: 1 },
    { status: "passed", total: 1 },
  ]);
  // A baseline phase with a label the comparison cannot format.
  const baseline = resolve(fake.directory, "baseline.json");
  await writeFile(
    baseline,
    JSON.stringify({
      schemaVersion: 2,
      scenario: "request-volume-canaries",
      runId: "baseline",
      revision: "0123456789abcdef",
      status: "complete",
      options: {},
      summary: [{ canary: "Gone", label: 7, occurrence: 0, byRequest: {} }],
      runs: [],
    }),
  );
  await expect(
    runCanaryCommand(["--baseline", baseline], fake.host),
  ).rejects.toThrow();
  const saved = await savedReport(fake.directory);
  expect(saved?.status).toBe("complete");
  expect(saved?.runs).toHaveLength(2);
});
