import { spawnSync } from "node:child_process";

import {
  ensureChanges,
  resolveReviewContext,
  spawnExitCode,
} from "./prContext";
import {
  DEFAULT_CODEX_EFFORT,
  type ReviewEffort,
  resolveReviewEffort,
} from "./reviewEffort";

/**
 * Build the `codex review` argv. The effort level is pinned with a
 * `model_reasoning_effort` config override so the review does not silently
 * inherit whatever `~/.codex/config.toml` sets. The value is quoted so it parses
 * as a TOML string, matching codex's own `-c key="value"` examples.
 */
export function buildCodexReviewArgs(
  context: { baseRef: string; prNumber: string; branch: string },
  effort: ReviewEffort,
): string[] {
  // The branch may not have a PR yet; title it by branch alone in that case
  // rather than emitting a bare `PR # (...)`.
  const title =
    context.prNumber.length > 0
      ? `PR #${context.prNumber} (${context.branch})`
      : `Branch ${context.branch}`;
  return [
    "review",
    "-c",
    `model_reasoning_effort="${effort}"`,
    "--base",
    context.baseRef,
    "--title",
    title,
  ];
}

/**
 * Ask the local `codex` CLI to review the current branch's diff. Codex derives
 * the diff itself from the base branch, so we only resolve and pass the base
 * ref; when the branch has no PR yet that base is the default branch, so a
 * review can run before the PR is opened. The effort level defaults to `high`
 * for Codex.
 */
export function solicitCodexReview(effortArg?: string): number {
  const effort = resolveReviewEffort(effortArg, DEFAULT_CODEX_EFFORT);
  const context = resolveReviewContext();
  ensureChanges(context.baseRef);

  const result = spawnSync("codex", buildCodexReviewArgs(context, effort), {
    stdio: "inherit",
  });
  return spawnExitCode("codex", result);
}
