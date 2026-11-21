import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const library = join(import.meta.dir, "screenshotsStore.sh");
const pinnedCli = join(import.meta.dir, "../../node_modules/.bin/agent-tool");
const captureWrapper = join(import.meta.dir, "../testing/takeScreenshots.sh");
const { PATH = "" } = process.env;

// A stand-in for the clone's pinned agent-tool: records how it was run, then
// answers `screenshots status --json` with the store STUB_ARTIFACTS names,
// links .screenshots the way `screenshots link --apply` does, and succeeds for
// any other command, unless STUB_FAIL makes everything but status fail.
const STUB = `#!/usr/bin/env bun
import { appendFileSync, symlinkSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.STUB_LOG, JSON.stringify({ cwd: process.cwd(), args, noGh: process.env.MATRIX_ARTIFACTS_NO_GH ?? null }) + "\\n");
if (args[1] === "status") {
  if (process.env.STUB_STATUS_ERROR) process.exit(2);
  console.log(JSON.stringify({ artifacts: process.env.STUB_ARTIFACTS, entries: [] }, null, 2));
  process.exit(1);
}
if (process.env.STUB_FAIL) process.exit(1);
if (args[1] === "link") symlinkSync("../matrix-artifacts/app/screenshots", ".screenshots");
`;

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

interface Fixture {
  readonly root: string;
  readonly repo: string;
  readonly store: string;
  readonly log: string;
}

function fixture(): Fixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "screenshots-store-")));
  temporary.push(root);
  const repo = join(root, "repo");
  mkdirSync(join(root, "home"));
  // Marks a Git checkout, which is all the stub cases need of one.
  mkdirSync(join(repo, ".git"), { recursive: true });
  return {
    root,
    repo,
    store: join(root, "matrix-artifacts"),
    log: join(root, "stub.log"),
  };
}

/** Installs the stub as the clone's pinned `node_modules/.bin/agent-tool`. */
function installCli(repo: string, cli = STUB): void {
  const bin = join(repo, "node_modules/.bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "agent-tool"), cli);
  chmodSync(join(bin, "agent-tool"), 0o755);
}

interface Result {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function run(
  { root, store, log }: Fixture,
  cmd: string[],
  env: Record<string, string> = {},
): Result {
  const result = Bun.spawnSync({
    cmd,
    env: {
      PATH,
      HOME: join(root, "home"),
      STUB_LOG: log,
      STUB_ARTIFACTS: store,
      ...env,
    },
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

/** Runs a script with the library sourced, under `set -e` as callers are. */
function runSh(
  setup: Fixture,
  script: string,
  env: Record<string, string> = {},
): Result {
  return run(setup, ["sh", "-c", `set -e\n. "${library}"\n${script}`], env);
}

interface StubRun {
  readonly cwd: string;
  readonly args: string[];
  readonly noGh: string | null;
}

function stubRuns(log: string): StubRun[] {
  return existsSync(log)
    ? readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    : [];
}

const quiet = { exitCode: 0, stdout: "", stderr: "" };

/** Whether anything, a dangling link included, is at `path`. */
function present(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

test("finds the clone's own pinned agent-tool, and fails before it is installed", () => {
  const setup = fixture();
  expect(runSh(setup, `screenshots_store_cli "${setup.repo}"`).exitCode).toBe(
    1,
  );
  installCli(setup.repo);
  expect(runSh(setup, `screenshots_store_cli "${setup.repo}"`).stdout).toBe(
    `${setup.repo}/node_modules/.bin/agent-tool\n`,
  );
});

test("links a clone with no .screenshots through the pinned link --apply, run from the clone, once the store exists", () => {
  const setup = fixture();
  installCli(setup.repo);
  mkdirSync(setup.store);
  expect(runSh(setup, `screenshots_store_link "${setup.repo}"`)).toEqual(quiet);
  expect(stubRuns(setup.log)).toEqual([
    {
      cwd: setup.repo,
      args: ["screenshots", "status", "--json"],
      noGh: "1",
    },
    { cwd: setup.repo, args: ["screenshots", "link", "--apply"], noGh: null },
  ]);
  expect(readlinkSync(join(setup.repo, ".screenshots"))).toBe(
    "../matrix-artifacts/app/screenshots",
  );
});

test("does nothing where the store does not exist, as in CI, and never creates it", () => {
  const setup = fixture();
  installCli(setup.repo);
  expect(runSh(setup, `screenshots_store_link "${setup.repo}"`)).toEqual(quiet);
  expect(stubRuns(setup.log).map(({ args }) => args)).toEqual([
    ["screenshots", "status", "--json"],
  ]);
  expect(present(join(setup.repo, ".screenshots"))).toBe(false);
  expect(present(setup.store)).toBe(false);
});

test("does nothing before agent-tool is installed", () => {
  const setup = fixture();
  mkdirSync(setup.store);
  expect(runSh(setup, `screenshots_store_link "${setup.repo}"`)).toEqual(quiet);
  expect(present(join(setup.repo, ".screenshots"))).toBe(false);
});

test("does nothing outside a Git checkout, as in a source archive", () => {
  const setup = fixture();
  rmSync(join(setup.repo, ".git"), { recursive: true });
  installCli(setup.repo);
  mkdirSync(setup.store);
  expect(runSh(setup, `screenshots_store_link "${setup.repo}"`)).toEqual(quiet);
  expect(stubRuns(setup.log)).toEqual([]);
  expect(present(join(setup.repo, ".screenshots"))).toBe(false);
});

test("warns and still succeeds when agent-tool's status names no store", () => {
  const setup = fixture();
  installCli(setup.repo);
  mkdirSync(setup.store);
  const result = runSh(
    setup,
    `screenshots_store_link "${setup.repo}"\necho after`,
    { STUB_STATUS_ERROR: "1" },
  );
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe("after\n");
  expect(result.stderr).toContain(
    "warning: agent-tool screenshots status named no store",
  );
  expect(stubRuns(setup.log).map(({ args }) => args)).toEqual([
    ["screenshots", "status", "--json"],
  ]);
  expect(present(join(setup.repo, ".screenshots"))).toBe(false);
});

test("leaves any existing .screenshots alone: a directory, a link, or a dangling link", () => {
  for (const make of [
    (path: string) => mkdirSync(path),
    (path: string) => symlinkSync("../matrix-artifacts/app/screenshots", path),
    (path: string) => symlinkSync("../nowhere", path),
  ]) {
    const setup = fixture();
    installCli(setup.repo);
    mkdirSync(setup.store);
    const screenshots = join(setup.repo, ".screenshots");
    make(screenshots);
    const before = lstatSync(screenshots);
    expect(runSh(setup, `screenshots_store_link "${setup.repo}"`)).toEqual(
      quiet,
    );
    expect(stubRuns(setup.log)).toEqual([]);
    expect(lstatSync(screenshots).ino).toBe(before.ino);
  }
});

test("warns and still succeeds when agent-tool refuses the link, so a build goes on", () => {
  const setup = fixture();
  installCli(setup.repo);
  mkdirSync(setup.store);
  const result = runSh(
    setup,
    `screenshots_store_link "${setup.repo}"\necho after`,
    { STUB_FAIL: "1" },
  );
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe("after\n");
  expect(result.stderr).toContain(
    "warning: could not link .screenshots to the shared screenshot store",
  );
  expect(stubRuns(setup.log)).toHaveLength(2);
});

test("the pinned agent-tool links a clone only where its store already exists", () => {
  const setup = fixture();
  const git = (...args: string[]) =>
    expect(
      Bun.spawnSync({ cmd: ["git", ...args], cwd: setup.repo }).exitCode,
    ).toBe(0);
  rmSync(join(setup.repo, ".git"), { recursive: true });
  git("init", "--quiet");
  git("remote", "add", "origin", "git@github.com:a2f0/app.git");
  writeFileSync(join(setup.repo, ".gitignore"), ".screenshots\n");
  writeFileSync(
    join(setup.repo, "package.json"),
    JSON.stringify({ scripts: { screenshots: "true" } }),
  );
  mkdirSync(join(setup.repo, "node_modules/.bin"), { recursive: true });
  symlinkSync(
    realpathSync(pinnedCli),
    join(setup.repo, "node_modules/.bin/agent-tool"),
  );
  const env = {
    MATRIX_ARTIFACTS_DIR: setup.store,
    MATRIX_ARTIFACTS_NO_GH: "1",
  };
  const link = `screenshots_store_link "${setup.repo}"`;

  expect(runSh(setup, link, env)).toEqual(quiet);
  expect(present(join(setup.repo, ".screenshots"))).toBe(false);
  expect(present(setup.store)).toBe(false);

  mkdirSync(setup.store);
  expect(runSh(setup, link, env).exitCode).toBe(0);
  expect(realpathSync(join(setup.repo, ".screenshots"))).toBe(
    join(setup.store, "app/screenshots"),
  );
}, 30_000);

/** A copy of the capture wrapper and its library, so REPO_ROOT is the fixture. */
function installWrapper(repo: string): string {
  mkdirSync(join(repo, "scripts/testing"), { recursive: true });
  mkdirSync(join(repo, "scripts/lib"), { recursive: true });
  copyFileSync(library, join(repo, "scripts/lib/screenshotsStore.sh"));
  const wrapper = join(repo, "scripts/testing/takeScreenshots.sh");
  copyFileSync(captureWrapper, wrapper);
  return wrapper;
}

test("the capture wrapper delegates a linked clone's capture to the pinned agent-tool", () => {
  const setup = fixture();
  installCli(setup.repo);
  symlinkSync(
    "../matrix-artifacts/app/screenshots",
    join(setup.repo, ".screenshots"),
  );
  const wrapper = installWrapper(setup.repo);
  expect(run(setup, ["sh", wrapper, "--project=mobile"]).exitCode).toBe(0);
  expect(stubRuns(setup.log)).toEqual([
    {
      cwd: setup.repo,
      args: ["screenshots", "capture", "--apply", "--", "--project=mobile"],
      noGh: null,
    },
  ]);
});

test("the capture wrapper refuses a linked clone before agent-tool is installed", () => {
  const setup = fixture();
  symlinkSync(
    "../matrix-artifacts/app/screenshots",
    join(setup.repo, ".screenshots"),
  );
  const result = run(setup, ["sh", installWrapper(setup.repo)]);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("the pinned agent-tool is not installed");
  expect(result.stderr).toContain("agent-tool screenshots capture --apply");
});
