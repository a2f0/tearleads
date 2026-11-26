import { stripVTControlCharacters } from "node:util";

/** Bun's `--timings` table: test file paths relative to the package → ms. */
export type TimingsTable = Readonly<Record<string, number>>;

const timestamp = /^\d{4}-\d\d-\d\dT[\d:.]+Z /;
// Turbo's grouped CI output opens each task with `##[group]<package>:<task>`
// and then names its cache key; Bun opens each run of one file's results with
// `##[group]<path>:`.
const taskHeader = /^##\[group\](\S+):(\S+)$/;
const cacheLine = /^cache .* ([0-9a-f]{16})$/;
const fileHeader = /^##\[group\](\S+):$/;
const caseResult = /^\((?:pass|fail)\) .* \[(\d+(?:\.\d+)?)ms\]$/;

export type TestTask = {
  readonly name: string;
  /** Turbo's hash: a replay repeats the durations of the run that made it. */
  hash: string;
  readonly files: Map<string, number>;
  /** The file whose results the log is printing. */
  file?: string | undefined;
};

function readTaskLine(task: TestTask, line: string) {
  const cache = task.hash ? undefined : cacheLine.exec(line)?.[1];
  if (cache) task.hash = cache;
  const opened = fileHeader.exec(line)?.[1];
  if (opened) task.files.set(opened, task.files.get(opened) ?? 0);
  if (opened || line.startsWith("##[endgroup]")) task.file = opened;
  const ms = caseResult.exec(line)?.[1];
  if (ms && task.file)
    task.files.set(task.file, (task.files.get(task.file) ?? 0) + Number(ms));
}

/**
 * Sums the case durations Bun printed for each file of each Turbo `test` task
 * in one GitHub Actions job log. Under `--parallel` a file's results arrive in
 * several groups; they add up. Hook and import time is not printed, so a file
 * costs at least what its cases took.
 */
export function caseDurations(log: string): TestTask[] {
  const tasks: TestTask[] = [];
  let task: TestTask | undefined;
  for (const raw of log.split(/\r?\n/)) {
    const line = stripVTControlCharacters(raw).replace(timestamp, "");
    const header = taskHeader.exec(line);
    if (header) {
      task =
        header[2] === "test"
          ? { name: header[1] ?? "", hash: "", files: new Map() }
          : undefined;
      if (task) tasks.push(task);
    } else if (task) readTaskLine(task, line);
  }
  return tasks;
}

const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The median of each file's samples, in the order Bun writes a table. */
export function medianTable(
  samples: ReadonlyMap<string, readonly number[]>,
): TimingsTable {
  const rows = [...samples]
    .filter(([, values]) => values.length > 0)
    .map(([path, values]) => {
      const sorted = values.toSorted((a, b) => a - b);
      const middle = sorted.length / 2;
      const median = Number.isInteger(middle)
        ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
        : (sorted[Math.floor(middle)] ?? 0);
      return [path, Math.round(median)] as const;
    });
  rows.sort(([a, x], [b, y]) => y - x || byPath(a, b));
  return Object.fromEntries(rows);
}

export function formatTimings(files: TimingsTable): string {
  return `${JSON.stringify({ version: 1, files }, null, 2)}\n`;
}

/**
 * The files of each `--shard=<i>/<count>` under Bun 1.4.3's `--timings`
 * partition: path-sorted files cut into contiguous runs of about equal cost,
 * where a file the table lacks costs the table's median. Every shard computes
 * the same cut from the same files and table, so each file runs in exactly
 * one shard.
 */
export function timedShards(
  table: TimingsTable,
  testFiles: readonly string[],
  count: number,
): string[][] {
  const known = Object.values(table)
    .map(Math.round)
    .toSorted((a, b) => a - b);
  const median = known[Math.floor(known.length / 2)] ?? 0;
  const files = testFiles.toSorted(byPath);
  const costs = files.map((path) =>
    Math.max(Math.round(table[path] ?? median), 1),
  );
  let remaining = costs.reduce((sum, cost) => sum + cost, 0);
  const shards: string[][] = [];
  let next = 0;
  for (let shard = 0; shard < count; shard += 1) {
    const target = Math.floor(remaining / (count - shard));
    const start = next;
    let load = 0;
    const fits = (cost: number) =>
      shard === count - 1 ||
      load === 0 ||
      (2 * load + cost <= 2 * target &&
        files.length - next > count - 1 - shard);
    while (next < files.length && fits(costs[next] ?? 0)) {
      load += costs[next] ?? 0;
      next += 1;
    }
    remaining -= load;
    shards.push(files.slice(start, next));
  }
  return shards;
}
