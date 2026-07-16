import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeSync } from "node:fs";
import path from "node:path";

import {
  ensureChanges,
  MAX_BUFFER_BYTES,
  type PrContext,
  resolveReviewContext,
  run,
  spawnExitCode,
} from "./prContext";
import {
  DEFAULT_CLAUDE_EFFORT,
  type ReviewEffort,
  resolveReviewEffort,
} from "./reviewEffort";
import { REVIEW_VERDICTS, reviewOutputProblem } from "./reviewOutput";

const REVIEW_INSTRUCTION_FILES = ["REVIEW.md", "AGENTS.md"];

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

export function buildReviewPrompt(params: {
  context: PrContext;
  diff: string;
  reviewInstructions: string;
}): string {
  const { context, diff, reviewInstructions } = params;
  // The review can run before the branch has a PR, in which case there is no
  // number to show — say so rather than printing a bare `PR: #`.
  const prLine =
    context.prNumber.length > 0
      ? `PR: #${context.prNumber}`
      : "PR: (not opened yet)";
  return `Review this PR diff using the project's review guidelines. Be concise and actionable.

## Review Guidelines
${reviewInstructions}

## PR Context
Branch: ${context.branch}
${prLine}
Base: ${context.baseRef}

## Diff
${diff}

## Instructions
- The full diff is above. Read the surrounding files when a finding depends on
  code the diff does not show; you have Read, Grep, and Glob for that. You cannot
  run commands, so do not plan to build, typecheck, or execute tests
- Flag security issues, type safety violations, and missing tests as high priority
- Use severity levels: Blocker, Major, Minor, Suggestion
- Be concise: one line per issue with file:line reference
- Output your review to stdout
- End with a verdict on its own line — \`VERDICT: X\` where X is ${REVIEW_VERDICTS.join(", ")} — naming the highest severity you found, or CLEAN when the diff needs no changes. Output with no verdict line is discarded and the review is retried with another agent.`;
}

function readReviewInstructions(rootDir: string): string {
  for (const candidate of REVIEW_INSTRUCTION_FILES) {
    const candidatePath = path.join(rootDir, candidate);
    if (existsSync(candidatePath)) {
      return readFileSync(candidatePath, "utf8");
    }
  }
  return "";
}

/** The environment a spawned reviewer runs with; it replaces, not extends. */
export type ReviewerEnv = Record<string, string | undefined>;

/**
 * Run `claude` over an already-built review prompt and relay whatever it says.
 *
 * Returns nonzero both when the CLI fails outright and when it exits 0 having
 * produced something that is not a review, so a caller's fallback chain treats a
 * degenerate review the same as a crashed one.
 */
export function spawnClaudeReview(
  prompt: string,
  effort: ReviewEffort,
  env: ReviewerEnv = process.env,
): number {
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

  const review = result.stdout ?? "";
  // writeSync, not process.stdout.write: when stdout is a pipe — which is how
  // every calling agent runs this — the async write queues, and `process.exit`
  // in index.ts drops whatever has not drained. That silently truncated reviews
  // at the 64 KiB pipe buffer, taking the trailing verdict line with them while
  // the in-memory check below still saw a complete review and exited 0.
  writeSync(1, review);

  const exitCode = spawnExitCode("claude", result);
  if (exitCode !== 0) {
    return exitCode;
  }

  const problem = reviewOutputProblem(review);
  if (problem !== null) {
    process.stderr.write(
      `claude exited 0 but produced no usable review: ${problem}\n`,
    );
    return 1;
  }
  return 0;
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
  });

  return spawnClaudeReview(prompt, effort);
}
