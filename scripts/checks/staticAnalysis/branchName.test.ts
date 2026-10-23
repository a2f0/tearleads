import { expect, test } from "bun:test";
import { resolve } from "node:path";
import commitlint, {
  commitHeaderMaxLength,
} from "../../../commitlint.config.mjs";

const repoRoot = resolve(import.meta.dir, "../../..");

// Invoke the pinned CLI directly so explicit empty arguments are preserved.
function lint(...names: string[]) {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "node_modules/.bin/agent-tool",
      "branch",
      "check",
      ...names,
    ],
    { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
  );
  return {
    code: result.exitCode,
    output: result.stdout.toString() + result.stderr.toString(),
  };
}

test("accepts conventional branch names and main", () => {
  expect(
    lint("ci/enforce-branch-names", "fix/2485-follow-up", "main").code,
  ).toBe(0);
});

test("rejects any named branch without a conventional type and short name", () => {
  for (const name of [
    "claude/epic-wright-l1f75j",
    "feat",
    "Feat/login",
    "feat/Login",
    "feat/invalid..ref",
    "feat/foo.lock",
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
    expect(output.length).toBeGreaterThan(0);
  }
});

test("branch and subject policy retain commitlint types and length", async () => {
  const policy = await Bun.file(`${repoRoot}/agent-tool.json`).json();
  expect(policy.branch.types).toBeNull();
  expect(policy.branch.maxLength).toBe(commitHeaderMaxLength);
  expect(policy.subject.maxLength).toBe(commitHeaderMaxLength);
  const types = commitlint.rules["type-enum"][2];
  if (!Array.isArray(types)) throw new Error("commitlint must declare types");
  expect(policy.subject.types.toSorted()).toEqual(types.toSorted());
});
