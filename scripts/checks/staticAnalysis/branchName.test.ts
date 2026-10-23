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
    // An explicit empty name is linted too; only no names at all falls back to
    // the checked-out branch.
    "",
  ]) {
    const { code, output } = lint("feat/valid", name);
    expect(code, name).toBe(1);
    const report = JSON.parse(output);
    expect(report.branches[1].name).toBe(name);
    expect(report.branches[1].errors.length).toBeGreaterThan(0);
  }
});

test("option-like positional inputs are rejected by the CLI argument contract", () => {
  for (const name of ["--", "-x", "--help"]) {
    const result = lint("feat/valid", name);
    expect(result.code).toBe(1);
    expect(result.output).toContain("Usage: branch check");
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

test("ref tuples preserve option-like names, skip deletions and tags, and reject malformed input", () => {
  const sha = "a".repeat(40);
  const zero = "0".repeat(40);
  const check = (input: string) =>
    Bun.spawnSync(
      [
        process.execPath,
        "node_modules/.bin/agent-tool",
        "branch",
        "check",
        "--pre-push",
      ],
      {
        cwd: repoRoot,
        stdin: Buffer.from(input),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
  const skipped = `(delete) ${zero} refs/heads/invalid ${sha}\nHEAD ${sha} refs/tags/-- ${zero}\n`;
  expect(check(skipped).exitCode).toBe(0);
  expect(
    check(`${skipped}HEAD ${sha} refs/heads/feat/valid ${zero}\n`).exitCode,
  ).toBe(0);
  for (const name of ["--", "--pre-push", "--help"]) {
    const result = check(`${skipped}HEAD ${sha} refs/heads/${name} ${zero}\n`);
    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout.toString());
    expect(report.branches).toHaveLength(1);
    expect(report.branches[0].name).toBe(name);
    expect(report.branches[0].errors).toContain(
      "Expected <type>/<lowercase-topic> using configured branch types.",
    );
  }
  expect(check("malformed\n").exitCode).toBe(1);
});
