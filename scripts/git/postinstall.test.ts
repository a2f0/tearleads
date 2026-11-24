import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  cpSync,
  existsSync,
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
// hooks in a fresh clone through the real pinned agent-tool, so the push gate
// runs without a separate setup step.

const repositoryRoot = join(import.meta.dir, "../..");
const hooks = ["commit-msg", "pre-commit", "pre-push"];
const { HOME = "", PATH = "" } = process.env;
const installed =
  "Installed the Git hooks (commit-msg, pre-commit, pre-push).\n";

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** A clone holding the hook sources and installers, committed when `git` is set. */
function clone(git: boolean): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "postinstall-hooks-")));
  temporary.push(root);
  for (const path of ["agent-tool.json", "scripts/git"]) {
    cpSync(join(repositoryRoot, path), join(root, path), { recursive: true });
  }
  rmSync(join(root, "scripts/git/postinstall.test.ts"));
  writeFileSync(join(root, "package.json"), '{"private":true}\n');
  writeFileSync(join(root, ".gitignore"), "node_modules\n");
  symlinkSync(
    join(repositoryRoot, "node_modules"),
    join(root, "node_modules"),
    "dir",
  );
  if (git) {
    for (const args of [
      ["init", "--quiet"],
      ["add", "--all"],
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "--quiet",
        "--message",
        "fixture",
      ],
    ]) {
      const result = Bun.spawnSync(["git", ...args], {
        cwd: root,
        env: { HOME, PATH },
      });
      if (result.exitCode) throw new Error(result.stderr.toString());
    }
  }
  return root;
}

/** Runs the postinstall from another directory, as `bun install` may. */
function postinstall(root: string, env: Record<string, string> = {}) {
  const result = Bun.spawnSync({
    cwd: tmpdir(),
    cmd: ["sh", join(root, "scripts/git/postinstall.sh")],
    env: { HOME, PATH, ...env },
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

test("the root package runs the hook installer after every install", () => {
  const manifest = JSON.parse(
    readFileSync(join(repositoryRoot, "package.json"), "utf8"),
  );
  expect(manifest.scripts.postinstall).toBe("sh scripts/git/postinstall.sh");
});

test("a fresh clone gets every tracked hook once, then stays quiet", () => {
  const root = clone(true);

  expect(postinstall(root)).toEqual({
    exitCode: 0,
    stdout: installed,
    stderr: "",
  });
  for (const hook of hooks) {
    expect(readFileSync(join(root, ".git/hooks", hook), "utf8")).toBe(
      readFileSync(join(root, "scripts/git/hooks", hook), "utf8"),
    );
  }
  expect(postinstall(root)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
}, 30_000);

test("CI installs nothing", () => {
  const root = clone(true);

  expect(postinstall(root, { CI: "true" })).toEqual({
    exitCode: 0,
    stdout: "",
    stderr: "",
  });
  for (const hook of hooks) {
    expect(existsSync(join(root, ".git/hooks", hook))).toBe(false);
  }
});

test("a copy without its own Git directory is left alone", () => {
  const root = clone(false);

  expect(postinstall(root)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  expect(existsSync(join(root, ".git"))).toBe(false);
});

test("an unmanaged hook is kept and reported without failing the install", () => {
  const root = clone(true);
  const prePush = join(root, ".git/hooks/pre-push");
  writeFileSync(prePush, "#!/bin/sh\n# someone's own hook\n");
  chmodSync(prePush, 0o755);

  expect(postinstall(root)).toEqual({
    exitCode: 0,
    stdout: "",
    stderr:
      "warning: the Git hooks are not installed; run sh scripts/git/install-hooks.sh to see why (docs/developer/static-analysis.md#ci-and-the-push-gate).\n",
  });
  expect(readFileSync(prePush, "utf8")).toBe(
    "#!/bin/sh\n# someone's own hook\n",
  );
  expect(existsSync(join(root, ".git/hooks/commit-msg"))).toBe(false);
}, 30_000);
