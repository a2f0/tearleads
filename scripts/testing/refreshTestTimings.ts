/**
 * Rewrites each workspace package's committed Bun `--timings` table (the file
 * its `test` script passes as `--timings=<file>`) from the case durations that
 * CI runs printed, then shows how CI's shards of each package would split.
 *
 *   bun scripts/testing/refreshTestTimings.ts <ci-run-id>...
 *
 * Pass runs whose `Test (...)` jobs ran the suites, such as the nightly
 * `Uncached tests` run. A Turbo replay prints the durations of the run that
 * produced it, so each task hash counts once. A file's time is the median
 * over the given runs.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkArguments } from "../lib/checkRoot";
import {
  caseDurations,
  formatTimings,
  medianTable,
  type TestTask,
  timedShards,
} from "./testTimings";

type TimedPackage = {
  name: string;
  dir: string;
  table: string;
  paths: string[];
};

const testFile = /(?:\.|_)(?:test|spec)\.[cm]?[jt]sx?$/;

function timedPackages(root: string): TimedPackage[] {
  return readdirSync(join(root, "packages")).flatMap((entry) => {
    const dir = join("packages", entry);
    const manifest = join(root, dir, "package.json");
    if (!existsSync(manifest)) return [];
    const { name, scripts } = JSON.parse(readFileSync(manifest, "utf8"));
    const script: string = scripts?.test ?? "";
    const table = /--timings=(\S+)/.exec(script)?.[1];
    if (!table) return [];
    const words = script.split(/\s+/);
    const paths = words
      .slice(words.indexOf("test") + 1)
      .filter((word) => !word.startsWith("-"));
    return [{ name, dir, table, paths }];
  });
}

function gh(root: string, args: string[]): string {
  return execFileSync("gh", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
}

// Direct CI jobs and those of the nightly run, which calls CI as `checks`.
const testJob = /(?:^|\/ )(?:Build and test|Test \(.+\))$/;

function testTasks(root: string, run: string): TestTask[] {
  const view = gh(root, ["run", "view", run, "--json", "jobs"]);
  const jobs: { databaseId: number; name: string }[] = JSON.parse(view).jobs;
  return jobs
    .filter(({ name }) => testJob.test(name))
    .flatMap(({ databaseId }) =>
      caseDurations(
        gh(root, [
          "api",
          "--allow-escape-sequences",
          `repos/{owner}/{repo}/actions/jobs/${databaseId}/logs`,
        ]),
      ),
    );
}

/** Each package's case-duration samples per file, one per distinct task. */
function measure(root: string, runs: string[], names: Set<string>) {
  const samples = new Map<string, Map<string, number[]>>();
  const seen = new Set<string>();
  for (const task of runs.flatMap((run) => testTasks(root, run))) {
    const key = `${task.name}#${task.hash}`;
    if (!names.has(task.name) || !task.hash || seen.has(key)) continue;
    seen.add(key);
    const table = samples.get(task.name) ?? new Map<string, number[]>();
    samples.set(task.name, table);
    for (const [path, ms] of task.files)
      table.set(path, [...(table.get(path) ?? []), ms]);
  }
  return samples;
}

function shardCounts(root: string): Map<string, number> {
  const ci = Bun.YAML.parse(
    readFileSync(join(root, ".github/workflows/ci.yml"), "utf8"),
  ) as {
    jobs: {
      test?: { strategy?: { matrix?: { include?: { filter?: string }[] } } };
    };
  };
  const counts = new Map<string, number>();
  for (const { filter = "" } of ci.jobs.test?.strategy?.matrix?.include ?? [])
    counts.set(filter, (counts.get(filter) ?? 0) + 1);
  return counts;
}

function testFiles(root: string, { dir, paths }: TimedPackage): string[] {
  const tracked = execFileSync("git", ["ls-files", "--", ...paths], {
    cwd: join(root, dir),
    encoding: "utf8",
  });
  return tracked.split("\n").filter((path) => testFile.test(path));
}

const { root, args: runs } = checkArguments();
if (runs.length === 0 || runs.some((run) => !/^\d+$/.test(run)))
  throw new Error("Usage: refreshTestTimings.ts <ci-run-id>...");
const packages = timedPackages(root);
const samples = measure(root, runs, new Set(packages.map(({ name }) => name)));
const counts = shardCounts(root);
for (const pkg of packages) {
  const files = testFiles(root, pkg);
  const present = new Set(files);
  const measured = new Map(
    [...(samples.get(pkg.name) ?? [])].filter(([path]) => present.has(path)),
  );
  if (measured.size === 0) {
    console.log(`${pkg.name}: no case durations in these runs; left as is`);
    continue;
  }
  const table = medianTable(measured);
  writeFileSync(join(root, pkg.dir, pkg.table), formatTimings(table));
  const missing = files.filter((path) => !measured.has(path)).length;
  const shards = timedShards(table, files, counts.get(pkg.name) ?? 1);
  const seconds = shards.map((shard) =>
    Math.round(shard.reduce((sum, path) => sum + (table[path] ?? 0), 0) / 1000),
  );
  console.log(
    `${pkg.name}: ${measured.size} files timed, ${missing} untimed; ` +
      `shard case seconds ${seconds.join(" ")}`,
  );
}
