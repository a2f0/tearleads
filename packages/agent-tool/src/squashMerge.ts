import { spawnSync } from "node:child_process";

import { resolvePr, spawnExitCode } from "./prContext";
import { validateCommitSubject } from "./validateCommitSubject";

/**
 * Squash-merge the open PR for the current branch with a subject-only commit
 * message — no auto-generated body or extended message. The subject defaults to
 * the PR title when one is not supplied, and is validated against the repo's
 * commitlint rules before the merge runs.
 */
export function squashMerge(
  rootDir: string,
  subjectArg: string | undefined,
): number {
  const pr = resolvePr();

  const subject = (subjectArg ?? "").trim() || pr.title;
  if (subject.length === 0) {
    throw new Error(
      "No squash subject provided and the PR has no title to fall back to.",
    );
  }

  validateCommitSubject(rootDir, subject);

  const result = spawnSync(
    "gh",
    [
      "pr",
      "merge",
      pr.prNumber,
      "--squash",
      "--subject",
      subject,
      // Empty body keeps the squash commit to the subject line only.
      "--body",
      "",
      "-R",
      pr.repo,
    ],
    { stdio: "inherit" },
  );
  return spawnExitCode("gh pr merge", result);
}
