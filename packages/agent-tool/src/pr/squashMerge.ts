import { spawnSync } from "node:child_process";

import { prState, resolvePr, spawnExitCode } from "../git/prContext";
import { appendPrNumberSuffix, stripPrNumberSuffix } from "./prNumberSuffix";
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
 * Build the `gh pr merge` argv for a subject-only squash. When
 * `expectedHeadSha` is provided, `--match-head-commit` makes GitHub reject the
 * merge unless the PR head is exactly that commit — closing the window where a
 * commit pushed after a review could be merged unreviewed (used by `ship-pr`).
 */
export function buildSquashMergeArgs(
  pr: { prNumber: string; repo: string },
  finalSubject: string,
  expectedHeadSha?: string,
): string[] {
  const args = [
    "pr",
    "merge",
    pr.prNumber,
    "--squash",
    "--subject",
    finalSubject,
    // Empty body keeps the squash commit to the subject line only.
    "--body",
    "",
    "-R",
    pr.repo,
  ];
  if (expectedHeadSha !== undefined && expectedHeadSha.length > 0) {
    // GitHub atomically refuses the merge if the PR head has moved off this SHA.
    args.push("--match-head-commit", expectedHeadSha);
  }
  return args;
}

/**
 * Squash-merge the open PR for the current branch with a subject-only commit
 * message — no auto-generated body or extended message. The subject defaults to
 * the PR title when one is not supplied, and is validated against the repo's
 * commitlint rules before the merge runs. When `expectedHeadSha` is supplied the
 * merge is bound to that commit via `--match-head-commit`.
 */
export function squashMerge(
  rootDir: string,
  subjectArg: string | undefined,
  expectedHeadSha?: string,
): number {
  const pr = resolvePr();
  const subject = resolveSubject(subjectArg, pr.title);

  // Validate the human-authored subject without the PR-number suffix: GitHub's
  // native squash appends `(#<n>)` server-side, past the commit-msg hook, so the
  // repo's existing history carries suffixes over the 50-char header limit. Keep
  // the suffix "free" here too by validating the base, then append it ourselves —
  // `gh pr merge --subject` otherwise drops GitHub's automatic reference.
  const baseSubject = stripPrNumberSuffix(subject);
  validateCommitSubject(rootDir, baseSubject);
  const finalSubject = appendPrNumberSuffix(baseSubject, pr.prNumber);

  const result = spawnSync(
    "gh",
    buildSquashMergeArgs(pr, finalSubject, expectedHeadSha),
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
