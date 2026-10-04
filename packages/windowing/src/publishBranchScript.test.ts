import { afterEach, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const fixtures: string[] = [];
afterEach(() => {
  for (const directory of fixtures.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

// Stands in for the package build: it writes a consumer manifest and an entry
// module, whose contents BUILD_CONTENT varies, into the output directory.
const fakeBun = String.raw`#!${process.execPath}
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
appendFileSync(process.env.BUILD_LOG, JSON.stringify(args) + "\n");
const source = JSON.parse(readFileSync(join(args[2], "package.json"), "utf8"));
const output = args.at(-1);
writeFileSync(join(output, "package.json"), JSON.stringify({
  name: source.name, version: source.version, main: "./index.js"
}, null, 2));
writeFileSync(join(output, "index.js"), process.env.BUILD_CONTENT + "\n");
`;

// A throwaway repository with a bare origin and no hooks, so the script's
// push never reaches a real remote or a repository's pre-push checks.
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "windowing branch ")));
  fixtures.push(root);
  const repo = join(root, "repo");
  const remote = join(root, "remote.git");
  const bin = join(root, "bin");
  const log = join(root, "builds.jsonl");
  for (const directory of [
    join(repo, "scripts"),
    join(repo, "packages", "windowing"),
    bin,
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  cpSync(
    resolve(import.meta.dir, "../../../scripts/publishWindowingBranch.sh"),
    join(repo, "scripts", "publishWindowingBranch.sh"),
  );
  writeFileSync(
    join(repo, "packages", "windowing", "package.json"),
    JSON.stringify({ name: "@tearleads/windowing", version: "1.2.3" }),
  );
  writeFileSync(join(bin, "bun"), fakeBun, { mode: 0o755 });
  const { PATH } = process.env;
  const env = {
    ...process.env,
    BUILD_LOG: log,
    BUILD_CONTENT: "export const Window = () => null;",
    GIT_AUTHOR_EMAIL: "dist@example.com",
    GIT_AUTHOR_NAME: "Dist",
    GIT_COMMITTER_EMAIL: "dist@example.com",
    GIT_COMMITTER_NAME: "Dist",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    // The script publishes only from the workflow.
    GITHUB_ACTIONS: "true",
    PATH: `${bin}:${PATH}`,
    TMPDIR: root,
  };
  const git = (cwd: string, ...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd, env });
    if (result.exitCode !== 0) {
      throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
    }
    return result.stdout.toString().trim();
  };
  git(root, "init", "--quiet", "--bare", remote);
  git(root, "init", "--quiet", repo);
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "source");
  git(repo, "remote", "add", "origin", remote);
  return {
    source: git(repo, "rev-parse", "HEAD"),
    git,
    remote,
    // Commits a newer source revision and returns it.
    advance() {
      git(repo, "commit", "--quiet", "--allow-empty", "-m", "newer source");
      return git(repo, "rev-parse", "HEAD");
    },
    checkout(revision: string) {
      git(repo, "checkout", "--quiet", "--detach", revision);
    },
    run(args: readonly string[] = [], overrides: Record<string, string> = {}) {
      const result = Bun.spawnSync(
        ["bash", join(repo, "scripts", "publishWindowingBranch.sh"), ...args],
        { cwd: repo, env: { ...env, ...overrides } },
      );
      return {
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        stdout: result.stdout.toString(),
      };
    },
    branchCommits() {
      const heads = git(root, "--git-dir", remote, "branch", "--list");
      if (!heads.includes("dist/windowing")) return [];
      return git(
        root,
        "--git-dir",
        remote,
        "log",
        "--format=%H %P|%s",
        "dist/windowing",
      ).split("\n");
    },
    builds() {
      if (!existsSync(log)) return [];
      return readFileSync(log, "utf8").trim().split("\n");
    },
  };
}

test("publishes the built package as the branch's whole tree", () => {
  const repo = fixture();
  const result = repo.run();

  expect(result.exitCode).toBe(0);
  const [tip] = repo.branchCommits();
  const [ids, subject] = tip?.split("|") ?? [];
  const [commit, parent] = ids?.split(" ") ?? [];
  // The first publish has no parent.
  expect(parent).toBe("");
  expect(subject).toBe(`windowing 1.2.3 from ${repo.source}`);
  expect(
    repo.git(repo.remote, "ls-tree", "--name-only", "dist/windowing"),
  ).toBe("index.js\npackage.json");
  expect(result.stdout).toContain(`Pin: github:a2f0/tearleads#${commit}`);
});

test("a new build fast-forwards the branch from its previous tip", () => {
  const repo = fixture();
  expect(repo.run().exitCode).toBe(0);
  expect(
    repo.run([], { BUILD_CONTENT: "export const Window = () => 1;" }).exitCode,
  ).toBe(0);

  const [tip, first] = repo.branchCommits();
  const firstCommit = first?.split(" ")[0];
  expect(tip?.split("|")[0]?.split(" ")[1]).toBe(firstCommit);
});

test("a build identical to the tip publishes nothing", () => {
  const repo = fixture();
  expect(repo.run().exitCode).toBe(0);
  const again = repo.run();

  expect(again.exitCode).toBe(0);
  expect(again.stdout).toContain("already holds this build");
  expect(repo.branchCommits()).toHaveLength(1);
});

test("a build of an older source than the tip's publishes nothing", () => {
  const repo = fixture();
  const newer = repo.advance();
  expect(repo.run().exitCode).toBe(0);

  repo.checkout(repo.source);
  const stale = repo.run([], {
    BUILD_CONTENT: "export const Window = () => 0;",
  });

  expect(stale.exitCode).toBe(0);
  expect(stale.stdout).toContain("not publishing an older build");
  const commits = repo.branchCommits();
  expect(commits).toHaveLength(1);
  expect(commits[0]).toEndWith(`from ${newer}`);
});

test("outside GitHub Actions only a dry run is allowed", () => {
  const repo = fixture();
  const push = repo.run([], { GITHUB_ACTIONS: "" });

  expect(push.exitCode).toBe(1);
  expect(push.stderr).toContain("only the Windowing dist workflow publishes");
  expect(repo.builds()).toEqual([]);
  expect(repo.run(["--dry-run"], { GITHUB_ACTIONS: "" }).exitCode).toBe(0);
  expect(repo.branchCommits()).toEqual([]);
});

test("a dry run builds a commit but pushes nothing", () => {
  const repo = fixture();
  const result = repo.run(["--dry-run"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("not pushed");
  expect(repo.builds()).toHaveLength(1);
  expect(repo.branchCommits()).toEqual([]);
});

test.each([
  { args: ["--branch"] },
  { args: ["--remote", "--dry-run"] },
  { args: ["--unknown"] },
])("invalid options %j fail before building", ({ args }) => {
  const repo = fixture();

  expect(repo.run(args).exitCode).toBe(1);
  expect(repo.builds()).toEqual([]);
});
