import { afterAll, afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `bun install` runs the root postinstall, which installs the tracked Git
// hooks through the real pinned agent-tool in a checkout that has none, and
// never replaces hooks that are already installed.

const repositoryRoot = join(import.meta.dir, "../..");
const hooks = ["commit-msg", "pre-commit", "pre-push"];
const { PATH = "" } = process.env;
// The developer's home and Git configuration (template hooks, a global
// core.hooksPath) must not reach the fixture or the installer.
const home = realpathSync(mkdtempSync(join(tmpdir(), "postinstall-home-")));
afterAll(() => rmSync(home, { recursive: true, force: true }));
const env = {
  HOME: home,
  PATH,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};
const guide = "(docs/developer/static-analysis.md#ci-and-the-push-gate).";
const quiet = { exitCode: 0, stdout: "", stderr: "" };

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync({
    cwd,
    env,
    cmd: [
      "git",
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
  });
  if (result.exitCode) throw new Error(result.stderr.toString());
}

/**
 * A checkout holding the hook sources, the installers, and agent-tool. With
 * `stubCheck`, `bun run agent-tool` prints it for `hooks check` and fails
 * anything else.
 */
function checkout(
  options: { git?: boolean; agentTool?: boolean; stubCheck?: string } = {},
) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "postinstall-")));
  temporary.push(parent);
  const root = join(parent, "clone");
  mkdirSync(join(root, "scripts/git"), { recursive: true });
  cpSync(
    join(repositoryRoot, "agent-tool.json"),
    join(root, "agent-tool.json"),
  );
  for (const path of ["hooks", "install-hooks.sh", "postinstall.ts"]) {
    cpSync(
      join(repositoryRoot, "scripts/git", path),
      join(root, "scripts/git", path),
      { recursive: true },
    );
  }
  const agentTool = options.stubCheck ? "sh agent-tool-stub.sh" : "agent-tool";
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ private: true, scripts: { "agent-tool": agentTool } })}\n`,
  );
  if (options.stubCheck) {
    writeFileSync(join(root, "check.json"), options.stubCheck);
    writeFileSync(
      join(root, "agent-tool-stub.sh"),
      '[ "$1 $2" != "hooks check" ] || cat check.json\nexit 1\n',
    );
  }
  writeFileSync(join(root, ".gitignore"), "node_modules\n");
  if (options.agentTool !== false) linkModules(root);
  if (options.git !== false) {
    git(root, "init", "--quiet");
    git(root, "add", "--all");
    git(root, "commit", "--quiet", "--message", "fixture");
  }
  return root;
}

function linkModules(root: string): void {
  symlinkSync(
    join(repositoryRoot, "node_modules"),
    join(root, "node_modules"),
    "dir",
  );
}

/** Runs the postinstall from another directory, as `bun install` may. */
function postinstall(root: string, extra: Record<string, string> = {}) {
  const result = Bun.spawnSync({
    cwd: tmpdir(),
    cmd: [process.execPath, join(root, "scripts/git/postinstall.ts")],
    env: { ...env, ...extra },
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

const installed = (root: string, hook: string) =>
  readFileSync(join(root, ".git/hooks", hook), "utf8");
const source = (root: string, hook: string) =>
  readFileSync(join(root, "scripts/git/hooks", hook), "utf8");

test("the root package runs the hook installer after every install", () => {
  const manifest = JSON.parse(
    readFileSync(join(repositoryRoot, "package.json"), "utf8"),
  ) as { scripts: { postinstall?: string } };
  expect(manifest.scripts.postinstall).toBe("bun scripts/git/postinstall.ts");
});

test("a fresh clone gets every tracked hook once, then stays quiet", () => {
  const root = checkout();

  expect(postinstall(root)).toEqual({
    ...quiet,
    stdout: "Installed the Git hooks (commit-msg, pre-commit, pre-push).\n",
  });
  for (const hook of hooks) {
    expect(installed(root, hook)).toBe(source(root, hook));
  }
  expect(postinstall(root)).toEqual(quiet);
}, 30_000);

test("a linked worktree installs into the shared hooks directory", () => {
  const root = checkout();
  const worktree = `${root}-worktree`;
  git(root, "worktree", "add", "--quiet", worktree);
  linkModules(worktree);
  expect(lstatSync(join(worktree, ".git")).isFile()).toBe(true);

  expect(postinstall(worktree).stdout).toBe(
    "Installed the Git hooks (commit-msg, pre-commit, pre-push).\n",
  );
  for (const hook of hooks) {
    expect(installed(root, hook)).toBe(source(root, hook));
  }
}, 30_000);

test("Git variables naming another checkout do not redirect the install", () => {
  const root = checkout();
  const other = checkout();

  const result = postinstall(root, {
    GIT_DIR: join(other, ".git"),
    GIT_WORK_TREE: other,
  });

  expect(result.stdout, result.stderr).toBe(
    "Installed the Git hooks (commit-msg, pre-commit, pre-push).\n",
  );
  for (const hook of hooks) {
    expect(installed(root, hook)).toBe(source(root, hook));
    expect(existsSync(join(other, ".git/hooks", hook))).toBe(false);
  }
}, 30_000);

test("hooks that differ from the branch's are never replaced", () => {
  const root = checkout();
  expect(postinstall(root).exitCode).toBe(0);
  const current = installed(root, "pre-push");
  // A branch whose pre-push predates the installed copy.
  writeFileSync(
    join(root, "scripts/git/hooks/pre-push"),
    "#!/bin/sh\n# an older pre-push without a newer guard\n",
  );
  git(root, "commit", "--quiet", "--all", "--message", "older hook");

  expect(postinstall(root)).toEqual({
    ...quiet,
    stderr: `warning: the installed Git hooks differ from this branch's and were left as they are; once the branch includes the latest main, run sh scripts/git/install-hooks.sh ${guide}\n`,
  });
  expect(installed(root, "pre-push")).toBe(current);
}, 30_000);

test("a hook removed from an installed checkout is not restored", () => {
  const root = checkout();
  expect(postinstall(root).exitCode).toBe(0);
  rmSync(join(root, ".git/hooks/pre-push"));

  expect(postinstall(root)).toEqual({
    ...quiet,
    stderr: `warning: the installed Git hooks differ from this branch's and were left as they are; once the branch includes the latest main, run sh scripts/git/install-hooks.sh ${guide}\n`,
  });
  expect(existsSync(join(root, ".git/hooks/pre-push"))).toBe(false);
}, 30_000);

test("an unmanaged hook is kept and reported without failing the install", () => {
  const root = checkout();
  const prePush = join(root, ".git/hooks/pre-push");
  writeFileSync(prePush, "#!/bin/sh\n# someone's own hook\n");
  chmodSync(prePush, 0o755);

  expect(postinstall(root)).toEqual({
    ...quiet,
    stderr: [
      `warning: the Git hooks were left as they are ${guide}`,
      "  pre-push: unmanaged file; inspect it, then use --adopt to back it up.",
      "",
    ].join("\n"),
  });
  expect(readFileSync(prePush, "utf8")).toBe(
    "#!/bin/sh\n# someone's own hook\n",
  );
  expect(existsSync(join(root, ".git/hooks/commit-msg"))).toBe(false);
}, 30_000);

test("a locally edited hook is kept and reported", () => {
  const root = checkout();
  expect(postinstall(root).exitCode).toBe(0);
  const preCommit = join(root, ".git/hooks/pre-commit");
  writeFileSync(preCommit, `${installed(root, "pre-commit")}# local edit\n`);

  expect(postinstall(root)).toEqual({
    ...quiet,
    stderr: [
      `warning: the Git hooks were left as they are ${guide}`,
      "  pre-commit: installed file was locally edited; preserve it before installing.",
      "",
    ].join("\n"),
  });
  expect(readFileSync(preCommit, "utf8")).toEndWith("# local edit\n");
}, 30_000);

test("a core.hooksPath from the user's Git configuration is not overridden", () => {
  const root = checkout();
  const config = join(root, "..", "gitconfig");
  const shared = join(root, "..", "shared-hooks");
  writeFileSync(config, `[core]\n\thooksPath = ${shared}\n`);

  expect(postinstall(root, { GIT_CONFIG_GLOBAL: config })).toEqual({
    ...quiet,
    stderr: [
      `warning: the Git hooks were left as they are ${guide}`,
      "  core.hooksPath in your Git configuration names another directory; sh scripts/git/install-hooks.sh would override it for this checkout.",
      "",
    ].join("\n"),
  });
  for (const hook of hooks) {
    expect(existsSync(join(root, ".git/hooks", hook))).toBe(false);
    expect(existsSync(join(shared, hook))).toBe(false);
  }
  expect(readFileSync(join(root, ".git/config"), "utf8")).not.toContain(
    "hooksPath",
  );
}, 30_000);

for (const [label, output] of [
  ["text", "not JSON\n"],
  [
    "a malformed change",
    JSON.stringify({ ok: false, changes: [{ target: 1 }], blockers: [] }),
  ],
] as const) {
  test(`an unreadable check (${label}) warns without failing the install`, () => {
    const root = checkout({ stubCheck: output });

    expect(postinstall(root)).toEqual({
      ...quiet,
      stderr: `warning: could not check the Git hooks; run bun run agent-tool hooks check ${guide}\n`,
    });
  });
}

test("a failed install warns without failing the install", () => {
  const root = checkout({
    stubCheck: JSON.stringify({
      ok: false,
      changes: [{ target: "pre-push", status: "create" }],
      blockers: [],
    }),
  });

  expect(postinstall(root)).toEqual({
    ...quiet,
    stderr: `warning: installing the Git hooks failed; run sh scripts/git/install-hooks.sh to see why ${guide}\n`,
  });
});

for (const value of ["true", "1"]) {
  test(`CI=${value} installs nothing`, () => {
    const root = checkout();

    expect(postinstall(root, { CI: value })).toEqual(quiet);
    for (const hook of hooks) {
      expect(existsSync(join(root, ".git/hooks", hook))).toBe(false);
    }
  });
}

test("CI=false still installs", () => {
  const root = checkout();

  expect(postinstall(root, { CI: "false" }).stdout).toBe(
    "Installed the Git hooks (commit-msg, pre-commit, pre-push).\n",
  );
}, 30_000);

test("a copy without its own Git directory is left alone", () => {
  const root = checkout({ git: false });

  expect(postinstall(root)).toEqual(quiet);
  expect(existsSync(join(root, ".git"))).toBe(false);
});

test("an install without agent-tool, such as a production one, is quiet", () => {
  const root = checkout({ agentTool: false });

  expect(postinstall(root)).toEqual(quiet);
  for (const hook of hooks) {
    expect(existsSync(join(root, ".git/hooks", hook))).toBe(false);
  }
});
