/**
 * Prints the browsers one Playwright shard runs, space separated, so a CI
 * shard installs only those (`bun scripts/e2eShardBrowsers.ts 2/3`). Firefox
 * and WebKit run only the themed-control specs, so most shards need Chromium
 * alone, and their system packages are most of the install time.
 */
import { resolve } from "node:path";
import config from "../playwright.config";

interface ListedSuite {
  readonly specs?: readonly {
    readonly tests?: readonly { readonly projectName: string }[];
  }[];
  readonly suites?: readonly ListedSuite[];
}

/** The project of every test in a `playwright test --list --reporter=json` report. */
export function listedProjects(suites: readonly ListedSuite[]): Set<string> {
  const projects = new Set<string>();
  const visit = (suite: ListedSuite) => {
    for (const spec of suite.specs ?? [])
      for (const { projectName } of spec.tests ?? []) projects.add(projectName);
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of suites) visit(suite);
  return projects;
}

/** The browsers that run those projects, in the config's project order. */
export function shardBrowsers(projectNames: ReadonlySet<string>): string[] {
  const browsers: string[] = [];
  for (const { name, use } of config.projects ?? []) {
    if (!name || !projectNames.has(name)) continue;
    const browser = use?.browserName;
    if (!browser) throw new Error(`Project ${name} names no browser`);
    if (!browsers.includes(browser)) browsers.push(browser);
  }
  return browsers;
}

if (import.meta.main) {
  const [shard] = process.argv.slice(2);
  if (!shard || !/^[1-9]\d*\/[1-9]\d*$/.test(shard))
    throw new Error("Usage: e2eShardBrowsers.ts <current>/<total>");
  const packageRoot = resolve(import.meta.dir, "..");
  const listing = Bun.spawnSync(
    [
      resolve(packageRoot, "node_modules/.bin/playwright"),
      "test",
      "--list",
      "--reporter=json",
      `--shard=${shard}`,
    ],
    { cwd: packageRoot, stdout: "pipe", stderr: "inherit" },
  );
  if (listing.exitCode !== 0)
    throw new Error(`playwright test --list exited ${listing.exitCode}`);
  const report = JSON.parse(listing.stdout.toString()) as {
    suites: ListedSuite[];
  };
  const browsers = shardBrowsers(listedProjects(report.suites));
  if (browsers.length === 0) throw new Error(`Shard ${shard} lists no tests`);
  console.log(browsers.join(" "));
}
