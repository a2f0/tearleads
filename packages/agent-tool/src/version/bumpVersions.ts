import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  bumpPatch,
  isReleaseBump,
  manifestPath,
  readVersion,
  withVersion,
  workspacePackages,
} from "./packageVersion";

export interface VersionPlan {
  readonly manifest: string;
  readonly baseVersion: string;
  readonly headVersion: string;
  readonly targetVersion: string;
}

const gitEnv = { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" };

function git(rootDir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: rootDir,
    env: gitEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function showFile(
  rootDir: string,
  commit: string,
  file: string,
): string | null {
  const result = spawnSync("git", ["show", `${commit}:${file}`], {
    cwd: rootDir,
    env: gitEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.error) {
    throw result.error;
  }
  return result.status === 0 ? result.stdout : null;
}

function resolveBaseCommit(
  rootDir: string,
  baseOid: string | undefined,
): string {
  const oid = baseOid?.trim() ?? "";
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(oid)) {
    throw new Error("the base must be a full Git OID.");
  }
  return git(rootDir, ["rev-parse", "--verify", `${oid}^{commit}`]).trim();
}

/**
 * Whether the branch changes the package, counting its manifest only for edits
 * beyond the version field.
 */
function packageChanged(
  rootDir: string,
  mergeBase: string,
  packageDir: string,
  headManifest: string,
): boolean {
  const manifest = manifestPath(packageDir);
  const changed = git(rootDir, [
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    mergeBase,
    "HEAD",
    "--",
    packageDir,
  ])
    .split("\0")
    .filter(Boolean);
  if (changed.some((file) => file !== manifest)) {
    return true;
  }
  if (!changed.includes(manifest)) {
    return false;
  }
  const mergeBaseManifest = showFile(rootDir, mergeBase, manifest);
  if (mergeBaseManifest === null) {
    return true;
  }
  if (!Object.hasOwn(JSON.parse(mergeBaseManifest), "version")) {
    return true;
  }
  const version = readVersion(headManifest);
  return withVersion(mergeBaseManifest, version) !== headManifest;
}

/**
 * The version each package should carry at HEAD to merge onto `baseCommit`:
 * one patch past the base when the branch changes the package, the base's own
 * version when it does not, and a deliberate major or minor bump left alone.
 */
export function planVersions(
  rootDir: string,
  baseOid: string | undefined,
): VersionPlan[] {
  const baseCommit = resolveBaseCommit(rootDir, baseOid);
  const mergeBase = git(rootDir, ["merge-base", baseCommit, "HEAD"]).trim();
  const plans: VersionPlan[] = [];
  for (const packageDir of workspacePackages(rootDir)) {
    const manifest = manifestPath(packageDir);
    const baseManifest = showFile(rootDir, baseCommit, manifest);
    const headManifest = showFile(rootDir, "HEAD", manifest);
    if (headManifest === null) {
      continue;
    }
    const headVersion = readVersion(headManifest);
    // New packages keep their initial version. Existing workspaces that lacked
    // a version can initialize it once, then follow the same patch policy.
    if (baseManifest === null) {
      continue;
    }
    const baseVersion = readVersion(baseManifest, "0.0.0");
    let targetVersion = baseVersion;
    if (isReleaseBump(headVersion, baseVersion)) {
      targetVersion = headVersion;
    } else if (packageChanged(rootDir, mergeBase, packageDir, headManifest)) {
      targetVersion = bumpPatch(baseVersion);
    }
    plans.push({ manifest, baseVersion, headVersion, targetVersion });
  }
  return plans;
}

function describePlan(plan: VersionPlan): string {
  return `${plan.manifest}: ${plan.headVersion} -> ${plan.targetVersion} (base ${plan.baseVersion})`;
}

/**
 * Rewrite each versioned package.json whose HEAD version is not its target,
 * printing the rewritten paths on stdout for the caller to commit.
 */
export function bumpVersions(rootDir: string, baseOid?: string): number {
  const pending = planVersions(rootDir, baseOid).filter(
    (plan) => plan.headVersion !== plan.targetVersion,
  );
  const rewrites = pending.map((plan) => {
    const file = path.join(rootDir, plan.manifest);
    const committed = showFile(rootDir, "HEAD", plan.manifest) ?? "";
    // Staged edits count too: the caller's path-limited commit would drop them.
    const status = git(rootDir, [
      "status",
      "--porcelain",
      "--untracked-files=no",
      "--",
      plan.manifest,
    ]);
    if (status !== "" || readFileSync(file, "utf8") !== committed) {
      throw new Error(
        `${plan.manifest} has uncommitted changes; commit or discard them first.`,
      );
    }
    return { file, plan, source: withVersion(committed, plan.targetVersion) };
  });
  for (const { file, plan, source } of rewrites) {
    writeFileSync(file, source);
    process.stderr.write(`${describePlan(plan)}\n`);
    process.stdout.write(`${plan.manifest}\n`);
  }
  return 0;
}

/** Exit non-zero when a versioned package at HEAD is not at its target. */
export function checkVersions(rootDir: string, baseOid?: string): number {
  const stale = planVersions(rootDir, baseOid).filter(
    (plan) => plan.headVersion !== plan.targetVersion,
  );
  for (const plan of stale) {
    process.stderr.write(`Version needs a bump: ${describePlan(plan)}\n`);
  }
  return stale.length === 0 ? 0 : 1;
}
