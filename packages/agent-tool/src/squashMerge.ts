import { spawnSync } from "node:child_process";

import { prState, resolvePr, spawnExitCode } from "./prContext";
import { singleLineSubject } from "./subjectLine";
import { validateCommitSubject } from "./validateCommitSubject";

/**
 * Resolve the squash subject from the CLI argument, falling back to the PR
 * title. Rejects an empty subject and any embedded line break so the squash
 * commit stays a single subject line.
 */
export function resolveSubject(
  subjectArg: string | undefined,
  prTitle: string,
): string {
  return singleLineSubject(subjectArg, prTitle, "squash subject");
}

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
  const subject = resolveSubject(subjectArg, pr.title);

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
  const exitCode = spawnExitCode("gh pr merge", result);
  if (exitCode !== 0) {
    return exitCode;
  }

  // `gh pr merge` can exit 0 after only queuing the PR (merge queue / auto-merge),
  // where the queue also picks the method. Confirm the squash actually landed.
  const state = prState(pr.prNumber, pr.repo);
  if (state !== "MERGED") {
    process.stderr.write(
      `PR #${pr.prNumber} is not merged (state: ${state || "unknown"}). ` +
        "It may be queued or blocked; the subject-only squash is not guaranteed.\n",
    );
    return 1;
  }

  return 0;
}
