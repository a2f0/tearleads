import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const library = join(repoRoot, "scripts/stepTimings.sh");
const reader = join(repoRoot, "scripts/git/showPushGateTimings.sh");

function runSh(
  script: string,
  environment: Record<string, string> = {},
): string {
  const result = Bun.spawnSync({
    cmd: ["sh", "-c", `set -e\n. "${library}"\n${script}`],
    cwd: repoRoot,
    env: { ...process.env, ...environment },
  });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  return result.stdout.toString();
}

function runReader(...args: readonly string[]): string {
  const result = Bun.spawnSync({ cmd: [reader, ...args], cwd: repoRoot });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  return result.stdout.toString();
}

function newLogPath(): string {
  return join(mkdtempSync(join(tmpdir(), "stepTimings-")), "timings.tsv");
}

interface SummaryRow {
  readonly label: string;
  readonly valueColumn: number;
  readonly value: string;
}

function summaryRows(output: string): readonly SummaryRow[] {
  const lines = output.split("\n");
  const start = lines.indexOf("--- Timing summary ---");
  expect(start).toBeGreaterThanOrEqual(0);
  return lines
    .slice(start + 1)
    .filter((line) => line.startsWith("  ") && !/^ *-+ *$/.test(line))
    .map((line) => {
      const match = /^ {2}(\S+) +(\S+)$/.exec(line);
      const label = match?.[1];
      const value = match?.[2];
      if (label === undefined || value === undefined) {
        throw new Error(`unparsable summary row: "${line}"`);
      }
      return { label, value, valueColumn: line.indexOf(value) };
    });
}

function summaryRule(output: string): string {
  const rule = output.split("\n").find((line) => /^ *-+ *$/.test(line));
  if (rule === undefined) {
    throw new Error("the summary printed no rule above its total");
  }
  return rule.trim();
}

test("the summary aligns every value on the longest label", () => {
  const output = runSh(`
    step_timings_reset
    step_timings_run short true
    step_timings_skip a-much-longer-label --skip-infra
    step_timings_summary
  `);

  expect(output).toContain("--- [short] true ---");
  expect(output).toContain(
    "--- [a-much-longer-label] skipped (--skip-infra) ---",
  );

  const rows = summaryRows(output);
  expect(rows.map((row) => row.label)).toEqual([
    "short",
    "a-much-longer-label",
    "total",
  ]);
  // A skipped step keeps its marker where a duration would be.
  expect(rows[1]?.value).toBe("skipped");
  expect(new Set(rows.map((row) => row.valueColumn)).size).toBe(1);
  expect(summaryRule(output).length).toBeGreaterThanOrEqual(
    "a-much-longer-label".length,
  );
});

test("durations render as minutes and zero-padded seconds", () => {
  const output = runSh(`
    step_timings_record quick 7
    step_timings_record slow 3671
    { printf '%s' "$step_timings_rows"; printf 'total\\t60\\n'; } |
      step_timings_render_table
  `);

  const values = new Map(
    summaryRows(output).map((row) => [row.label, row.value]),
  );
  expect(values.get("quick")).toBe("0m07s");
  expect(values.get("slow")).toBe("61m11s");
  expect(values.get("total")).toBe("1m00s");
});

test("a logged run carries its metadata and one line per step", async () => {
  const file = newLogPath();
  runSh(`
    step_timings_reset
    step_timings_run first true >/dev/null
    step_timings_run second true >/dev/null
    step_timings_append_log "${file}" status=passed head=abc123 remote=origin
  `);

  const lines = (await Bun.file(file).text()).trim().split("\n");
  expect(lines[0]).toStartWith("run\tat=");
  expect(lines[0]).toContain("\tstatus=passed\thead=abc123\tremote=origin");
  // Seconds, not a fixed 0: a real clock can tick between two `date` calls.
  expect(lines[1]).toMatch(/^step\tfirst\t\d+$/);
  expect(lines[2]).toMatch(/^step\tsecond\t\d+$/);
  expect(lines).toHaveLength(3);
});

test("a run that dies mid-step records the step it stopped in", async () => {
  const file = newLogPath();
  runSh(`
    step_timings_reset
    step_timings_begin tests "Running bun tests" >/dev/null
    step_timings_append_log "${file}" status=failed head=abc123
  `);

  expect(await Bun.file(file).text()).toContain("\tunfinished=tests\t");
});

test("a failing check stops the gate, and is recorded as the last step", async () => {
  // The real hook, with `bun` stubbed to fail: its first check runs `bun run
  // lint:branch-name`, so the gate dies in its first step. Everything the
  // recording depends on — errexit, the EXIT trap, the refs file — is the
  // hook's own wiring, which is only worth asserting against the hook itself.
  const stubDirectory = mkdtempSync(join(tmpdir(), "stepTimings-bin-"));
  await Bun.write(join(stubDirectory, "bun"), "#!/bin/sh\nexit 3\n");
  chmodSync(join(stubDirectory, "bun"), 0o755);
  const file = newLogPath();

  const result = Bun.spawnSync({
    cmd: ["sh", join(repoRoot, "scripts/git/hooks/pre-push"), "origin", "url"],
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${stubDirectory}:${process.env.PATH}`,
      PUSH_GATE_TIMINGS_LOG: file,
    },
    stdin: Buffer.from(`refs/heads/x abc123 refs/heads/x def456\n`),
  });

  // The check's own status reaches git, so a failed gate still refuses the push.
  expect(result.exitCode).toBe(3);
  const output = result.stdout.toString();
  expect(output).toContain("--- [branch-name] bun run lint:branch-name ---");
  expect(output).not.toContain("[shellcheck]");
  expect(output).not.toContain("All checks passed.");

  const written = await Bun.file(file).text();
  expect(written).toContain("\tstatus=failed\t");
  expect(written).toContain("\tunfinished=branch-name\t");
  expect(written).toContain("\thead=abc123\t");
  expect(written).not.toContain("step\tbranch-name");
});

test("the log keeps only the most recent runs", async () => {
  const file = newLogPath();
  for (const head of ["one", "two", "three", "four"]) {
    runSh(
      `
      step_timings_reset
      step_timings_run only true >/dev/null
      step_timings_append_log "${file}" status=passed head=${head}
    `,
      { STEP_TIMINGS_LOG_RUNS: "2" },
    );
  }

  const written = await Bun.file(file).text();
  expect(written).not.toContain("head=one");
  expect(written).not.toContain("head=two");
  expect(written).toContain("head=three");
  expect(written).toContain("head=four");
});

test("the reader reports the run that pushed a given head", () => {
  const file = newLogPath();
  for (const [head, label] of [
    ["aaa111", "older"],
    ["bbb222", "newer"],
  ]) {
    runSh(`
      step_timings_reset
      step_timings_run ${label} true >/dev/null
      step_timings_append_log "${file}" status=passed branch=feat/x head=${head} remote=origin
    `);
  }

  const latest = runReader("--log", file);
  expect(latest).toContain("Push gate: feat/x at ");
  expect(latest).toContain("pushed bbb222 to origin");
  expect(summaryRows(latest).map((row) => row.label)).toEqual([
    "newer",
    "total",
  ]);

  const pinned = runReader("--log", file, "--head", "aaa111");
  expect(pinned).toContain("pushed aaa111 to origin");
  expect(summaryRows(pinned).map((row) => row.label)).toEqual([
    "older",
    "total",
  ]);
});

test("a push carrying several refs is found by any of its heads", () => {
  const file = newLogPath();
  runSh(`
    step_timings_reset
    step_timings_run only true >/dev/null
    step_timings_append_log "${file}" status=passed head=aaa111 head=bbb222 remote=origin
  `);

  expect(runReader("--log", file)).toContain("pushed aaa111, bbb222 to origin");
  for (const head of ["aaa111", "bbb222"]) {
    expect(runReader("--log", file, "--head", head)).toContain(
      "pushed aaa111, bbb222 to origin",
    );
  }
});

test("the reader stays quiet about pushes it has no record of", () => {
  const file = newLogPath();
  runSh(`
    step_timings_reset
    step_timings_run only true >/dev/null
    step_timings_append_log "${file}" status=passed head=aaa111
  `);

  expect(runReader("--log", file, "--head", "deadbee")).toBe(
    "No push-gate run recorded for deadbee.\n",
  );
  expect(runReader("--log", join(file, "missing.tsv"))).toContain(
    "No push-gate timings recorded yet",
  );
});
