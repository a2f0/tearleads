import { spawnSync } from "node:child_process";
import path from "node:path";

import {
  MAX_BUFFER_BYTES,
  resolveReviewContext,
  spawnExitCode,
} from "../git/prContext";
import { withPinnedReviewInput } from "./pinnedReviewInput";
import {
  DEFAULT_CLAUDE_EFFORT,
  type ReviewEffort,
  resolveReviewEffort,
} from "./reviewEffort";
import { buildReviewPrompt, CLAUDE_ACCESS_NOTE } from "./reviewPrompt";
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
 *
 * `--safe-mode` also disables project/user instructions, skills, plugins,
 * hooks, and MCP servers so the branch cannot expand the reviewer's authority.
 * Browser integration and session persistence are disabled explicitly too.
 * `dontAsk` fails closed on unapproved access, while the absolute Read rule
 * confines file inspection to the immutable snapshot.
 */
const REVIEW_TOOLS = ["Read", "Grep", "Glob"] as const;

function absoluteClaudeReadRule(snapshotRoot: string): string {
  const normalized = path.resolve(snapshotRoot).replaceAll("\\", "/");
  return `Read(//${normalized.replace(/^\/+/, "")}/**)`;
}

/**
 * Build the `claude` argv for a non-interactive review at the given effort
 * level. The prompt itself goes over stdin, not argv.
 */
export function buildClaudeReviewArgs(
  effort: ReviewEffort,
  snapshotRoot: string,
): string[] {
  return [
    "--effort",
    effort,
    "--print",
    "--safe-mode",
    "--no-chrome",
    "--no-session-persistence",
    "--permission-mode",
    "dontAsk",
    "--tools",
    REVIEW_TOOLS.join(","),
    "--allowedTools",
    absoluteClaudeReadRule(snapshotRoot),
  ];
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
  snapshotRoot: string,
  env: ReviewerEnv = process.env,
): number {
  return relayReviewWithRetry("claude", () => {
    // Captured rather than inherited: a review has to be read to be judged, and
    // `claude` exits 0 whether it reviewed the diff or merely said it would.
    // `--print` emits the review in one final block, so nothing streams anyway.
    const result = spawnSync(
      "claude",
      buildClaudeReviewArgs(effort, snapshotRoot),
      {
        stdio: ["pipe", "pipe", "inherit"],
        input: prompt,
        encoding: "utf8",
        maxBuffer: MAX_BUFFER_BYTES,
        cwd: snapshotRoot,
        // Passed explicitly so `claude` resolves against this PATH rather than
        // the one the runtime snapshotted at startup.
        env,
      },
    );
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
  return withPinnedReviewInput(rootDir, context, (input) => {
    const prompt = buildReviewPrompt({
      context,
      diff: input.diff,
      reviewInstructions: input.reviewInstructions,
      accessNote: CLAUDE_ACCESS_NOTE,
      repositoryRoot: input.snapshotRoot,
    });

    return spawnClaudeReview(prompt, effort, input.snapshotRoot);
  });
}
