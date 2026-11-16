import { expect, test } from "bun:test";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../..");
const library = join(repoRoot, "scripts/lib/stepTimings.sh");

function runSh(script: string): string {
  const result = Bun.spawnSync({
    cmd: ["sh", "-c", `set -e\n. "${library}"\n${script}`],
    cwd: repoRoot,
  });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  return result.stdout.toString();
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

test("an open step stays named until it ends, so a failure can report it", () => {
  // destroyTier.sh names the step a teardown stopped in from this variable.
  const output = runSh(`
    step_timings_reset
    step_timings_begin edge "Destroying edge" >/dev/null
    printf 'open=%s\\n' "$step_timings_open_label"
    step_timings_end >/dev/null
    printf 'closed=%s\\n' "$step_timings_open_label"
  `);

  expect(output).toContain("open=edge\n");
  expect(output).toContain("closed=\n");
});
