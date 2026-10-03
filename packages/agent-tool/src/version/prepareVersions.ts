import { checkVersions, planVersions, rewriteVersions } from "./bumpVersions";
import {
  assertAllowedPaths,
  assertClean,
  assertHead,
  changedPaths,
  git,
  headOid,
  runBun,
} from "./versionPreparationGit";

function commitPreparedVersions(
  rootDir: string,
  startHead: string,
  allowed: readonly string[],
): void {
  git(rootDir, ["add", "--", ...allowed]);
  const preparedTree = git(rootDir, ["write-tree"]);
  runBun(rootDir, ["run", "lint:source-shape", "--", "--staged"]);
  assertHead(rootDir, startHead);
  assertAllowedPaths(rootDir, allowed);
  if (
    git(rootDir, ["diff", "--name-only"]) ||
    git(rootDir, ["write-tree"]) !== preparedTree
  ) {
    throw new Error("Validation changed the prepared files or index.");
  }
  git(rootDir, ["commit", "-m", "chore: bump package versions"]);
  if (
    git(rootDir, ["rev-parse", "HEAD^", "HEAD^{tree}"]) !==
    `${startHead}\n${preparedTree}`
  ) {
    throw new Error("The version commit differs from the prepared snapshot.");
  }
}

/** Prepare and commit versions plus their lockfile before taking a review snapshot. */
export function prepareVersions(rootDir: string, baseOid?: string): number {
  assertClean(rootDir);
  const startHead = headOid(rootDir);
  const plans = planVersions(rootDir, baseOid);
  const baseCommit = git(rootDir, ["rev-parse", `${baseOid}^{commit}`]);
  try {
    git(rootDir, ["merge-base", "--is-ancestor", baseCommit, startHead]);
  } catch {
    throw new Error(
      "Merge the pinned base into HEAD before preparing versions.",
    );
  }
  const pending = plans.filter(
    (plan) => plan.headVersion !== plan.targetVersion,
  );
  const allowed = [...pending.map((plan) => plan.manifest), "bun.lock"];
  let committed = false;
  let lockfileChanged = false;
  try {
    assertHead(rootDir, startHead);
    rewriteVersions(rootDir, baseCommit);
    // Also repairs a stale lockfile after a deliberate release or new package.
    runBun(rootDir, ["install", "--lockfile-only", "--ignore-scripts"]);
    assertHead(rootDir, startHead);
    assertAllowedPaths(rootDir, allowed);
    const changed = changedPaths(rootDir);
    lockfileChanged = changed.includes("bun.lock");
    if (changed.length) {
      commitPreparedVersions(rootDir, startHead, allowed);
      committed = true;
    }
    if (checkVersions(rootDir, baseCommit) !== 0) {
      throw new Error("Prepared versions do not match the pinned base.");
    }
    assertClean(rootDir);
  } catch (error) {
    // A clean starting tree permits a narrow rollback before a commit lands.
    // Preserve intermediate state if another operation changed HEAD or other paths.
    if (
      headOid(rootDir) === startHead &&
      changedPaths(rootDir).every((file) => allowed.includes(file))
    ) {
      git(rootDir, [
        "restore",
        `--source=${startHead}`,
        "--staged",
        "--worktree",
        "--",
        ...allowed,
      ]);
      process.stderr.write(
        "Restored version manifests, lockfile, and index to the starting commit.\n",
      );
    } else {
      process.stderr.write(
        "Preserved intermediate state because HEAD or other files changed; inspect git status before retrying.\n",
      );
    }
    throw error;
  }
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: 1,
      baseOid: baseCommit,
      startHead,
      headOid: headOid(rootDir),
      committed,
      lockfileChanged,
      versions: pending.map((plan) => ({
        manifest: plan.manifest,
        from: plan.headVersion,
        to: plan.targetVersion,
      })),
    })}\n`,
  );
  return 0;
}
