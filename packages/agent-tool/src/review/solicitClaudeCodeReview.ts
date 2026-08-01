import { spawnSync } from "node:child_process";

import {
  ensureChanges,
  MAX_BUFFER_BYTES,
  resolveReviewContext,
  run,
  spawnExitCode,
} from "../git/prContext";
import {
  DEFAULT_CLAUDE_EFFORT,
  type ReviewEffort,
  resolveReviewEffort,
} from "./reviewEffort";
import {
  buildReviewPrompt,
  CLAUDE_ACCESS_NOTE,
  readReviewInstructions,
} from "./reviewPrompt";
import { type ReviewerEnv, relayReviewWithRetry } from "./runReview";

/**
 * Tools the reviewer gets. Read-only, and deliberately not empty: the diff alone
 * does not show whether a changed line is safe, so the good findings come from
 * reading around it — an unchanged branch further up the file, the source-shape
 * baseline a file has to stay under, the callers a signature change breaks.
 *
 * `Bash` is withheld for two reasons, neither of which is reliability. A review
 * needs no shell, so every Bash call is a turn spent earning a denial (`--print`
 * denies what would need approval, hands the denial back, and carries on). And
 * the session's context is a PR diff — attacker-influenceable text on a public
 * repo — which is not something to hand a shell.
 */
const REVIEW_TOOLS = ["Read", "Grep", "Glob"] as const;

/**
 * Build the `claude` argv for a non-interactive review at the given effort
 * level. The prompt itself goes over stdin, not argv.
 */
export function buildClaudeReviewArgs(effort: ReviewEffort): string[] {
  return ["--effort", effort, "--print", "--tools", REVIEW_TOOLS.join(",")];
}

/**
 * Run `claude` over an already-built review prompt and relay whatever it says.
 *
 * Returns nonzero both when the CLI fails outright and when it exits 0 having
 * produced something that is not a review — after one retry of the latter, since
 * that failure is stochastic — so a caller's fallback chain treats a degenerate
 * review the same as a crashed one.
 */
export function spawnClaudeReview(
  prompt: string,
  effort: ReviewEffort,
  env: ReviewerEnv = process.env,
): number {
  return relayReviewWithRetry("claude", () => {
    // Captured rather than inherited: a review has to be read to be judged, and
    // `claude` exits 0 whether it reviewed the diff or merely said it would.
    // `--print` emits the review in one final block, so nothing streams anyway.
    const result = spawnSync("claude", buildClaudeReviewArgs(effort), {
      stdio: ["pipe", "pipe", "inherit"],
      input: prompt,
      encoding: "utf8",
      maxBuffer: MAX_BUFFER_BYTES,
      // Passed explicitly so `claude` resolves against this PATH rather than the
      // one the runtime snapshotted at startup.
      env,
    });
    return {
      exitCode: spawnExitCode("claude", result),
      review: result.stdout ?? "",
    };
  });
}

/**
 * Ask the local `claude` CLI to review the current branch's diff. Branch/PR/base
 * are derived from git + GitHub; when the branch has no PR yet the diff is taken
 * against the default branch, so a review can run before the PR is opened. The
 * prompt is streamed via stdin (not argv) to avoid "Argument list too long"
 * failures on large PRs. The effort level defaults to `xhigh` for Claude.
 */
export function solicitClaudeCodeReview(
  rootDir: string,
  effortArg?: string,
): number {
  const effort = resolveReviewEffort(effortArg, DEFAULT_CLAUDE_EFFORT);
  const context = resolveReviewContext();
  ensureChanges(context.baseRef);

  const diff = run("git", ["diff", `${context.baseRef}...HEAD`]);
  const prompt = buildReviewPrompt({
    context,
    diff,
    reviewInstructions: readReviewInstructions(rootDir),
    accessNote: CLAUDE_ACCESS_NOTE,
  });

  return spawnClaudeReview(prompt, effort);
}
