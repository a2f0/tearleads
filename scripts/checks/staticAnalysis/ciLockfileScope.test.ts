import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ciScopes, lockfileChangeIsCommon } from "../ciPolicy";
import { fixture } from "./fixture.testUtils";

const repoRoot = resolve(import.meta.dir, "../../..");
const script = resolve(import.meta.dir, "../ciChanges.ts");
const none = { native: false, proofs: false, terraform: false };
const all = { native: true, proofs: true, terraform: true };

interface LockfileOptions {
  version?: string;
  range?: string;
  integrity?: string;
  field?: string;
  workspaces?: string[];
}

// The shape `bun install` writes, trailing commas included.
function lockfile({
  version = "0.1.0",
  range = "1.0.0",
  integrity = "sha512-first",
  field = "dependencies",
  workspaces = ["packages/app"],
}: LockfileOptions = {}) {
  const entries = workspaces.map(
    (path) => `    "${path}": {
      "name": "@fixture/${path.split("/").at(-1)}",
      "version": "${version}",
      "${field}": {
        "left-pad": "${range}",
      },
    },`,
  );
  return `{
  "lockfileVersion": 1,
  "configVersion": 1,
  "workspaces": {
    "": {
      "name": "fixture",
    },
${entries.join("\n")}
  },
  "packages": {
    "left-pad": ["left-pad@${range}", "", {}, "${integrity}"],
  },
}
`;
}

test("a lockfile change confined to workspace versions exercises no platform lane", () => {
  const base = lockfile();
  const head = lockfile({ version: "0.1.1" });
  expect(lockfileChangeIsCommon({ base, head })).toBe(false);
  expect(
    ciScopes(["bun.lock", "packages/app/package.json"], { base, head }),
  ).toEqual(none);
  // Path selection still applies: a native package bump runs its lane.
  expect(
    ciScopes(["bun.lock", "packages/app-capacitor/package.json"], {
      base,
      head,
    }),
  ).toEqual({ ...none, native: true });
});

test("dependency, resolution, integrity, and workspace-set changes exercise every lane", () => {
  const base = lockfile();
  for (const head of [
    lockfile({ range: "1.0.1" }),
    lockfile({ version: "0.1.1", range: "1.0.1" }),
    lockfile({ integrity: "sha512-second" }),
    // Only the workspace entry changes; the resolved packages do not.
    lockfile({ field: "devDependencies" }),
    lockfile({ workspaces: ["packages/app", "packages/new"] }),
    lockfile({ workspaces: [] }),
    lockfile({ workspaces: ["packages/renamed"] }),
    base.replace('"lockfileVersion": 1', '"lockfileVersion": 2'),
  ]) {
    expect(lockfileChangeIsCommon({ base, head })).toBe(true);
    expect(ciScopes(["bun.lock"], { base, head })).toEqual(all);
  }
});

test("an unreadable or malformed lockfile exercises every lane", () => {
  const valid = lockfile();
  for (const broken of [
    undefined,
    "",
    "{",
    "[]",
    "null",
    '{ "workspaces": [] }',
    '{ "workspaces": { "packages/app": "0.1.0" } }',
  ]) {
    for (const lockfiles of [
      { base: valid, head: broken },
      { base: broken, head: valid },
      { base: broken, head: broken },
    ]) {
      expect(lockfileChangeIsCommon(lockfiles)).toBe(true);
      expect(ciScopes(["bun.lock"], lockfiles)).toEqual(all);
    }
  }
  expect(ciScopes(["bun.lock"])).toEqual(all);
});

test("the repository lockfile parses, and only its version fields are ignored", () => {
  const base = readFileSync(join(repoRoot, "bun.lock"), "utf8");
  expect(lockfileChangeIsCommon({ base, head: base })).toBe(false);
  const bumped = base.replace(
    /("name": "@tearleads\/[^"]+",\n\s+"version": ")([^"]+)"/,
    '$1$2-bumped"',
  );
  expect(bumped).not.toBe(base);
  expect(lockfileChangeIsCommon({ base, head: bumped })).toBe(false);
  const reresolved = base.replace(/"sha512-[^"]+"/, '"sha512-changed"');
  expect(reresolved).not.toBe(base);
  expect(lockfileChangeIsCommon({ base, head: reresolved })).toBe(true);
});

test("change detection compares the head's lockfile with the merge base's", () => {
  const repo = fixture();
  repo.write("bun.lock", lockfile());
  const start = repo.commit();
  // The base branch moves on with a dependency change after the branch point.
  repo.write("bun.lock", lockfile({ range: "2.0.0" }));
  const advancedBase = repo.commit();
  repo.git("checkout", "-q", "-b", "feature", start);
  repo.write("bun.lock", lockfile({ version: "0.1.1" }));
  const versionOnly = repo.commit();
  repo.write("bun.lock", lockfile({ version: "0.1.1", range: "1.0.1" }));
  const dependency = repo.commit();

  const detect = (base: string, head: string) => {
    const output = join(
      mkdtempSync(join(tmpdir(), "tearleads-ci-changes-")),
      "out",
    );
    const result = Bun.spawnSync(
      [process.execPath, script, "--check-root", repo.cwd],
      {
        cwd: repo.cwd,
        env: {
          ...repo.env,
          CI_BASE_SHA: base,
          CI_HEAD_SHA: head,
          GITHUB_OUTPUT: output,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    return Object.fromEntries(
      readFileSync(output, "utf8")
        .trim()
        .split("\n")
        .map((line) => {
          const [name, value] = line.split("=");
          return [name, value === "true"];
        }),
    );
  };
  expect(detect(advancedBase, versionOnly)).toEqual(none);
  expect(detect(advancedBase, dependency)).toEqual(all);
  expect(detect(versionOnly, dependency)).toEqual(all);
});
