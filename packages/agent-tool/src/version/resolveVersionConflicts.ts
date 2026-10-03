import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  isReleaseBump,
  isVersionedManifest,
  readVersion,
  withVersion,
} from "./packageVersion";

const gitEnv = { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" };

function git(rootDir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: rootDir,
    env: gitEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function stage(rootDir: string, index: 1 | 2 | 3, file: string): string {
  return git(rootDir, ["show", `:${index}:${file}`]);
}

/**
 * Three-way merge a manifest with every side's version set to one version, so
 * a version-only conflict merges cleanly: the branch's when it is a deliberate
 * major or minor release over the incoming base, which `bumpVersions` keeps,
 * and the base's otherwise. Null when anything besides the version still
 * conflicts.
 */
function mergeIgnoringVersion(rootDir: string, file: string): string | null {
  const ours = stage(rootDir, 2, file);
  const theirs = stage(rootDir, 3, file);
  const oursVersion = readVersion(ours);
  const theirsVersion = readVersion(theirs);
  const version = isReleaseBump(oursVersion, theirsVersion)
    ? oursVersion
    : theirsVersion;
  const scratch = mkdtempSync(path.join(tmpdir(), "agent-tool-version-merge-"));
  try {
    const inputs = {
      ours: withVersion(ours, version),
      base: withVersion(stage(rootDir, 1, file), version),
      theirs: withVersion(theirs, version),
    };
    const paths = Object.entries(inputs).map(([name, source]) => {
      const scratchFile = path.join(scratch, name);
      writeFileSync(scratchFile, source);
      return scratchFile;
    });
    const result = spawnSync("git", ["merge-file", "-p", ...paths], {
      cwd: rootDir,
      env: gitEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) {
      throw result.error;
    }
    return result.status === 0 ? result.stdout : null;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Finish an in-progress base merge whose only conflicts are the version field
 * of versioned package.json files: take the base's version (or the branch's
 * deliberate release) and stage the
 * result, leaving the bump itself to `bumpVersions`. Touches nothing and exits
 * non-zero when any conflict is something else.
 */
export function resolveVersionConflicts(rootDir: string): number {
  const inMerge = spawnSync(
    "git",
    ["rev-parse", "-q", "--verify", "MERGE_HEAD"],
    { cwd: rootDir, env: gitEnv, stdio: "ignore" },
  );
  if (inMerge.status !== 0) {
    process.stderr.write("Error: no merge is in progress.\n");
    return 1;
  }
  const conflicted = git(rootDir, [
    "diff",
    "--name-only",
    "--diff-filter=U",
    "-z",
  ])
    .split("\0")
    .filter(Boolean);
  if (conflicted.length === 0) {
    process.stderr.write("Error: the merge has no conflicts to resolve.\n");
    return 1;
  }
  const others = conflicted.filter(
    (file) => !isVersionedManifest(rootDir, file),
  );
  if (others.length > 0) {
    process.stderr.write(
      `Error: conflicts outside the versioned package.json files: ${others.join(", ")}\n`,
    );
    return 1;
  }
  const resolved = new Map<string, string>();
  for (const file of conflicted) {
    const merged = mergeIgnoringVersion(rootDir, file);
    if (merged === null) {
      process.stderr.write(
        `Error: ${file} conflicts beyond its version field.\n`,
      );
      return 1;
    }
    resolved.set(file, merged);
  }
  for (const [file, merged] of resolved) {
    writeFileSync(path.join(rootDir, file), merged);
    git(rootDir, ["add", "--", file]);
    process.stderr.write(`Resolved the version conflict in ${file}.\n`);
  }
  return 0;
}
