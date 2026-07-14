import { spawnSync } from "node:child_process";

import { ensureChanges, resolvePrContext, reviewExitCode } from "./prContext";

/**
 * Ask the local `codex` CLI to review the current PR diff. Codex derives the
 * diff itself from the base branch, so we only resolve and pass the base ref.
 */
export function solicitCodexReview(): number {
  const context = resolvePrContext();
  ensureChanges(context.baseRef);

  const result = spawnSync(
    "codex",
    [
      "review",
      "--base",
      context.baseRef,
      "--title",
      `PR #${context.prNumber} (${context.branch})`,
    ],
    { stdio: "inherit" },
  );
  return reviewExitCode("codex", result);
}
