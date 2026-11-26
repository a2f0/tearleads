import { relative } from "node:path";
import type {
  FullConfig,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

interface SpecTotal {
  readonly project: string;
  readonly file: string;
  durationMs: number;
  tests: number;
}

/**
 * One line per spec file and project, slowest first. The time is the sum of
 * the file's test durations, which is what moves when CI regroups spec files
 * into shards.
 */
export function formatSpecDurations(totals: Iterable<SpecTotal>): string[] {
  const rows = [...totals].sort(
    (left, right) => right.durationMs - left.durationMs,
  );
  return rows.map(
    ({ durationMs, project, file, tests }) =>
      `${(durationMs / 1000).toFixed(1).padStart(7)}s  ${project.padEnd(8)}  ${file} (${tests} ${tests === 1 ? "test" : "tests"})`,
  );
}

/**
 * Prints each spec file's summed test time at the end of a run, so a CI log
 * shows where a shard's time goes without a per-test line for every spec.
 */
export default class SpecDurationReporter implements Reporter {
  private rootDir = "";
  private shard = "";
  private readonly totals = new Map<string, SpecTotal>();

  onBegin(config: FullConfig): void {
    this.rootDir = config.rootDir;
    if (config.shard)
      this.shard = ` in shard ${config.shard.current}/${config.shard.total}`;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const project = test.parent.project()?.name ?? "";
    const file = relative(this.rootDir, test.location.file);
    const key = `${project}\0${file}`;
    const total = this.totals.get(key) ?? {
      project,
      file,
      durationMs: 0,
      tests: 0,
    };
    total.durationMs += result.duration;
    total.tests += 1;
    this.totals.set(key, total);
  }

  onEnd(): void {
    if (this.totals.size === 0) return;
    console.log(
      [
        "",
        `Spec durations${this.shard} (summed test time, slowest first):`,
        ...formatSpecDurations(this.totals.values()),
      ].join("\n"),
    );
  }

  printsToStdio(): boolean {
    return true;
  }
}
