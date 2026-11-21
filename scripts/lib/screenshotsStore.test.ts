import { afterEach, expect, test } from "bun:test";
import {
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
const { PATH = "" } = process.env;

// A stand-in for the take-screenshots skill's artifacts.ts: records how it was
// run, then links .screenshots the way `link --apply` does, or fails.
const STUB = `import { appendFileSync, symlinkSync } from "node:fs";
appendFileSync(process.env.STUB_LOG, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }) + "\\n");
if (process.env.STUB_FAIL) process.exit(1);
symlinkSync("../matrix-artifacts/app/screenshots", ".screenshots");
`;

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

interface Fixture {
  readonly home: string;
  readonly repo: string;
  readonly log: string;
}

function fixture(): Fixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "screenshots-store-")));
  temporary.push(root);
  const home = join(root, "home");
  const repo = join(root, "repo");
  mkdirSync(home);
  mkdirSync(repo);
  return { home, repo, log: join(root, "stub.log") };
}

/** Installs the stub where the skill lives under `home`, as `.agents` or `.claude`. */
function installSkill(home: string, harness: ".agents" | ".claude"): string {
  const scripts = join(home, harness, "skills/take-screenshots/scripts");
  mkdirSync(scripts, { recursive: true });
  const artifacts = join(scripts, "artifacts.ts");
  writeFileSync(artifacts, STUB);
  return artifacts;
}

function runSh(
  { home, log }: Fixture,
  script: string,
  env: Record<string, string> = {},
): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: ["sh", "-c", `set -e\n. "${library}"\n${script}`],
    env: { PATH, HOME: home, STUB_LOG: log, ...env },
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function stubRuns(log: string): { cwd: string; args: string[] }[] {
  return existsSync(log)
    ? readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    : [];
}

test("finds the skill under ~/.agents first, then ~/.claude, unless TAKE_SCREENSHOTS_ARTIFACTS names it", () => {
  const setup = fixture();
  expect(runSh(setup, "screenshots_store_script").exitCode).toBe(1);
  const claude = installSkill(setup.home, ".claude");
  expect(runSh(setup, "screenshots_store_script").stdout).toBe(`${claude}\n`);
  const agents = installSkill(setup.home, ".agents");
  expect(runSh(setup, "screenshots_store_script").stdout).toBe(`${agents}\n`);
  expect(
    runSh(setup, "screenshots_store_script", {
      TAKE_SCREENSHOTS_ARTIFACTS: "/elsewhere/artifacts.ts",
    }).stdout,
  ).toBe("/elsewhere/artifacts.ts\n");
});

test("links a clone with no .screenshots through the skill's link --apply, run from the clone", () => {
  const setup = fixture();
  installSkill(setup.home, ".claude");
  const result = runSh(setup, `screenshots_store_link "${setup.repo}"`);
  expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  expect(stubRuns(setup.log)).toEqual([
    { cwd: setup.repo, args: ["link", "--apply"] },
  ]);
  expect(readlinkSync(join(setup.repo, ".screenshots"))).toBe(
    "../matrix-artifacts/app/screenshots",
  );
});

test("leaves any existing .screenshots alone: a directory, a link, or a dangling link", () => {
  for (const make of [
    (path: string) => mkdirSync(path),
    (path: string) => symlinkSync("../matrix-artifacts/app/screenshots", path),
    (path: string) => symlinkSync("../nowhere", path),
  ]) {
    const setup = fixture();
    installSkill(setup.home, ".agents");
    const screenshots = join(setup.repo, ".screenshots");
    make(screenshots);
    const before = lstatSync(screenshots);
    expect(runSh(setup, `screenshots_store_link "${setup.repo}"`)).toEqual({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
    expect(stubRuns(setup.log)).toEqual([]);
    expect(lstatSync(screenshots).ino).toBe(before.ino);
  }
});

test("does nothing without the skill, as in CI", () => {
  const setup = fixture();
  expect(runSh(setup, `screenshots_store_link "${setup.repo}"`)).toEqual({
    exitCode: 0,
    stdout: "",
    stderr: "",
  });
  expect(existsSync(join(setup.repo, ".screenshots"))).toBe(false);
});

test("warns and still succeeds when the skill refuses the link, so a build goes on", () => {
  const setup = fixture();
  installSkill(setup.home, ".claude");
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
  expect(stubRuns(setup.log)).toHaveLength(1);
});
