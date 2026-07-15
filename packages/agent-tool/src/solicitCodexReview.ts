import { spawnSync } from "node:child_process";

import { ensureChanges, resolvePrContext, spawnExitCode } from "./prContext";
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
  return [
    "review",
    "-c",
    `model_reasoning_effort="${effort}"`,
    "--base",
    context.baseRef,
    "--title",
    `PR #${context.prNumber} (${context.branch})`,
  ];
}

/**
 * Ask the local `codex` CLI to review the current PR diff. Codex derives the
 * diff itself from the base branch, so we only resolve and pass the base ref.
 * The effort level defaults to `high` for Codex.
 */
export function solicitCodexReview(effortArg?: string): number {
  const effort = resolveReviewEffort(effortArg, DEFAULT_CODEX_EFFORT);
  const context = resolvePrContext();
  ensureChanges(context.baseRef);

  const result = spawnSync("codex", buildCodexReviewArgs(context, effort), {
    stdio: "inherit",
  });
  return spawnExitCode("codex", result);
}
