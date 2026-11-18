import { afterEach, expect, test } from "bun:test";
import { chmodSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  baselinePath,
  cleanSource,
  emptyBaseline,
  fixture,
  suppressedSource,
} from "./fixture.testUtils";

const fixtures: ReturnType<typeof fixture>[] = [];
function setup() {
  const repo = fixture();
  fixtures.push(repo);
  return repo;
}
afterEach(() => {
  for (const repo of fixtures.splice(0))
    rmSync(repo.cwd, { recursive: true, force: true });
});

test("staged checks use index source and baseline despite conflicting working edits", () => {
  const repo = setup();
  repo.write("source.ts", cleanSource);
  repo.commit();
  repo.write("source.ts", suppressedSource);
  repo.git("add", "source.ts");
  repo.write("source.ts", cleanSource);
  repo.baseline({
    ...emptyBaseline,
    suppressions: { "source.ts": { tsIgnore: 1 } },
  });
  expect(repo.scan("--staged")).toMatchObject({
    code: 1,
    output: expect.stringContaining("tsIgnore count is 1"),
  });
  repo.git("add", baselinePath);
  repo.baseline(emptyBaseline);
  expect(repo.scan("--staged").code).toBe(0);
});

test("staged checks accept clean index content even when working content violates budgets", () => {
  const repo = setup();
  repo.write("source.ts", cleanSource);
  repo.commit();
  repo.write("source.ts", `${cleanSource}\n`);
  repo.git("add", "source.ts");
  repo.write("source.ts", suppressedSource.repeat(510));
  expect(repo.scan("--staged").code).toBe(0);
});

test("an installed pre-commit hook checks Git's temporary index for a partial commit", () => {
  const repo = setup();
  repo.write("selected.ts", cleanSource);
  const base = repo.commit();
  for (const file of [
    "scripts/lib/checkRoot.ts",
    "scripts/checks/lintSourceShape.ts",
    "scripts/checks/sourceShapeSnapshot.ts",
    "scripts/checks/sourceShapeBaseline.ts",
  ]) {
    repo.write(
      file,
      readFileSync(resolve(import.meta.dir, "../../..", file), "utf8"),
    );
  }
  repo.write(
    ".git/hooks/pre-commit",
    `#!/bin/sh\nexec "${process.execPath}" scripts/checks/lintSourceShape.ts --staged\n`,
  );
  chmodSync(join(repo.cwd, ".git/hooks/pre-commit"), 0o755);
  repo.write("selected.ts", suppressedSource);
  const partial = Bun.spawnSync(
    [
      "git",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=.git/hooks",
      "commit",
      "--only",
      "-qm",
      "partial",
      "--",
      "selected.ts",
    ],
    {
      cwd: repo.cwd,
      env: repo.env,
    },
  );
  expect(partial.exitCode).toBe(1);
  expect(partial.stdout.toString() + partial.stderr.toString()).toContain(
    "tsIgnore count is 1",
  );
  expect(repo.git("rev-parse", "HEAD")).toBe(base);
});

test("range checks use the right commit's source and baseline, not HEAD or disk", () => {
  const repo = setup();
  repo.write("source.ts", cleanSource);
  const base = repo.commit();
  repo.write("source.ts", suppressedSource);
  const violating = repo.commit();
  repo.write("source.ts", cleanSource);
  repo.commit();
  repo.baseline({
    ...emptyBaseline,
    suppressions: { "source.ts": { tsIgnore: 1 } },
  });
  for (const dots of ["..", "..."]) {
    expect(repo.scan("--range", `${base}${dots}${violating}`)).toMatchObject({
      code: 1,
      output: expect.stringContaining("tsIgnore count is 1"),
    });
  }
  repo.write("source.ts", suppressedSource);
  const allowed = repo.commit();
  repo.baseline(emptyBaseline);
  expect(repo.scan(`--range=${base}..${allowed}`).code).toBe(0);
});

test("baseline-only changes validate unchanged source in both index and commit", () => {
  const repo = setup();
  repo.write("source.ts", suppressedSource);
  repo.baseline({
    ...emptyBaseline,
    suppressions: { "source.ts": { tsIgnore: 1 } },
  });
  const base = repo.commit();
  repo.baseline(emptyBaseline);
  repo.git("add", baselinePath);
  repo.write("source.ts", cleanSource);
  expect(repo.scan("--staged").code).toBe(1);
  repo.git("commit", "-qm", "baseline only");
  expect(repo.scan("--range", `${base}..HEAD`).code).toBe(1);
});

test("deletions and renames cannot strand allowances, including newline paths", () => {
  const repo = setup();
  const path = "source with\nspace.ts";
  repo.write(path, suppressedSource);
  repo.baseline({
    ...emptyBaseline,
    suppressions: { [path]: { tsIgnore: 1 } },
  });
  repo.commit();
  repo.git("mv", path, "renamed.ts");
  expect(repo.scan("--staged").output).toContain(
    "baseline refers to a missing file",
  );
  repo.baseline({
    ...emptyBaseline,
    suppressions: { "renamed.ts": { tsIgnore: 1 } },
  });
  repo.git("add", baselinePath);
  expect(repo.scan("--staged").code).toBe(0);
  repo.commit();
  repo.git("rm", "renamed.ts");
  expect(repo.scan("--staged").code).toBe(1);
  repo.baseline(emptyBaseline);
  repo.git("add", baselinePath);
  expect(repo.scan("--staged").code).toBe(0);
});

test("an initial staged commit is checked and invalid ranges fail closed", () => {
  const repo = setup();
  repo.write("source.ts", suppressedSource);
  repo.git("add", ".");
  expect(repo.scan("--staged").output).toContain("tsIgnore count is 1");
  expect(repo.scan("--range", "missing..HEAD").code).not.toBe(0);
  expect(repo.scan("--range", "HEAD").output).toContain("Usage:");
});
