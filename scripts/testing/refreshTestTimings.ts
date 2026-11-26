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
  collectSamples,
  formatTimings,
  isTestJob,
  medianTable,
  type TestTask,
  testScriptPaths,
  timedShards,
} from "./testTimings";

type TimedPackage = {
  name: string;
  dir: string;
  table: string;
  paths: string[];
};
type Manifest = { name?: unknown; scripts?: { test?: unknown } };
type RunView = { jobs: { databaseId: number; name: string }[] };
type Workflow = {
  jobs: {
    test?: { strategy?: { matrix?: { include?: { filter?: string }[] } } };
  };
};

const testFile = /(?:\.|_)(?:test|spec)\.[cm]?[jt]sx?$/;

function timedPackages(root: string): TimedPackage[] {
  return readdirSync(join(root, "packages")).flatMap((entry) => {
    const dir = join("packages", entry);
    const path = join(root, dir, "package.json");
    if (!existsSync(path)) return [];
    const manifest: Manifest = JSON.parse(readFileSync(path, "utf8"));
    const script = manifest.scripts?.test;
    if (typeof script !== "string") return [];
    const table = /--timings=(\S+)/.exec(script)?.[1];
    if (!table) return [];
    if (typeof manifest.name !== "string")
      throw new Error(`${path} has no package name`);
    return [
      { name: manifest.name, dir, table, paths: testScriptPaths(script) },
    ];
  });
}

function gh(root: string, args: string[]): string {
  return execFileSync("gh", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
}

function testTasks(root: string, run: string): TestTask[] {
  const view: RunView = JSON.parse(
    gh(root, ["run", "view", run, "--json", "jobs"]),
  );
  if (!Array.isArray(view.jobs)) throw new Error(`Run ${run} lists no jobs`);
  return view.jobs
    .filter(({ name }) => isTestJob(name))
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

function shardCounts(root: string): Map<string, number> {
  const ci = Bun.YAML.parse(
    readFileSync(join(root, ".github/workflows/ci.yml"), "utf8"),
  ) as Workflow;
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
const samples = collectSamples(
  runs.flatMap((run) => testTasks(root, run)),
  new Set(packages.map(({ name }) => name)),
);
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
  const untimed = files.filter((path) => !measured.has(path)).length;
  const shards = timedShards(table, files, counts.get(pkg.name) ?? 1);
  const seconds = shards.map(({ cost }) => Math.round(cost / 1000));
  console.log(
    `${pkg.name}: ${measured.size} files timed, ${untimed} untimed; ` +
      `shard case seconds ${seconds.join(" ")}`,
  );
}
