import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const baselinePath = "scripts/sourceShapeBaseline.json";
export const cleanSource = "export const value = 1;\n";
export const suppressedSource = ["//", " @ts-ignore\n", cleanSource].join("");
export const emptyBaseline = {
  fileSizes: {},
  suppressions: {},
  approvedStarExports: {},
};
const checker = resolve(import.meta.dir, "../../lintSourceShape.ts");

export function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "tearleads-static-analysis-"));
  // Hooks export Git variables for the caller's checkout. Nested fixtures must
  // never use that checkout's index, worktree, or object database.
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
    ),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
  };
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
      { cwd, env, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  };
  const baseline = (value: unknown) =>
    write(baselinePath, `${JSON.stringify(value)}\n`);
  const commit = () => {
    git("add", ".");
    git("commit", "-qm", "fixture");
    return git("rev-parse", "HEAD");
  };
  const scan = (...args: string[]) => {
    const result = Bun.spawnSync([process.execPath, checker, ...args], {
      cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      code: result.exitCode,
      output: result.stdout.toString() + result.stderr.toString(),
    };
  };
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  baseline(emptyBaseline);
  return { cwd, env, git, write, baseline, commit, scan };
}
