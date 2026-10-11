import { expect, test } from "bun:test";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");

// Invoked as pre-push and CI invoke it: Bun drops the leading `--`, so every
// name after it reaches the linter verbatim.
function lint(...names: string[]) {
  const result = Bun.spawnSync(
    [process.execPath, "scripts/checks/lintBranchName.ts", "--", ...names],
    { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
  );
  return { code: result.exitCode, output: result.stderr.toString() };
}

test("accepts conventional branch names and main", () => {
  expect(lint("ci/enforce-branch-names", "fix/2485-follow-up", "main")).toEqual(
    { code: 0, output: "" },
  );
});

test("rejects any named branch without a conventional type and short name", () => {
  for (const name of [
    "claude/epic-wright-l1f75j",
    "feat",
    "Feat/login",
    "feat/Login",
    `feat/${"a".repeat(46)}`,
    // Option-like names are still names, never a cue to lint the checkout.
    "--",
    "-x",
    "--help",
    // An explicit empty name is linted too; only no names at all falls back to
    // the checked-out branch.
    "",
  ]) {
    const { code, output } = lint("feat/valid", name);
    expect(code, name).toBe(1);
    expect(output).toContain(`Invalid branch name: ${name}\n`);
  }
});
