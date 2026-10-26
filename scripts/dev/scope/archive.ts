import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "tar";
import { gitAt as git } from "./git";

/** A clean checkout with only enough history to compare the pinned source/base. */
export async function createCodebaseArchive(
  repository: string,
  archive: string,
  ref: string,
  baseRef: string,
): Promise<{ commit: string; baseCommit: string }> {
  const resolve = (value: string) =>
    git(
      repository,
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${value}^{commit}`,
    );
  const commit = resolve(ref);
  const baseCommit = resolve(baseRef);
  const common = git(repository, "merge-base", commit, baseCommit);
  const depth =
    Number(
      git(
        repository,
        "rev-list",
        "--count",
        commit,
        baseCommit,
        "--not",
        common,
      ),
    ) + 1;
  const checkout = await mkdtemp(join(tmpdir(), "scope-checkout-"));
  try {
    git(
      checkout,
      "-c",
      "init.templateDir=",
      "init",
      "--initial-branch=scope-staging",
    );
    git(
      checkout,
      "fetch",
      "--no-tags",
      "--no-write-fetch-head",
      `--depth=${depth}`,
      repository,
      `${commit}:refs/heads/scope-snapshot`,
      `${baseCommit}:refs/remotes/origin/main`,
    );
    git(checkout, "checkout", "--detach", commit);
    if (git(checkout, "merge-base", "HEAD", "origin/main") !== common)
      throw new Error(
        "Snapshot does not retain the source/base merge ancestor",
      );
    // Fresh metadata contains no source remotes, credentials, hooks or alternates.
    // Reflogs are unnecessary for the benchmark and can name the host path.
    await rm(join(checkout, ".git/logs"), { recursive: true, force: true });
    await create({ cwd: checkout, file: archive, gzip: true, portable: true }, [
      ".",
    ]);
    return { commit, baseCommit };
  } finally {
    await rm(checkout, { recursive: true, force: true });
  }
}
