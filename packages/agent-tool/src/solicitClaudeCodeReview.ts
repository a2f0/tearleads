import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  ensureChanges,
  type PrContext,
  resolvePrContext,
  run,
  spawnExitCode,
} from "./prContext";

const REVIEW_INSTRUCTION_FILES = ["REVIEW.md", "AGENTS.md"];

export function buildReviewPrompt(params: {
  context: PrContext;
  diff: string;
  reviewInstructions: string;
}): string {
  const { context, diff, reviewInstructions } = params;
  return `Review this PR diff using the project's review guidelines. Be concise and actionable.

## Review Guidelines
${reviewInstructions}

## PR Context
Branch: ${context.branch}
PR: #${context.prNumber}
Base: ${context.baseRef}

## Diff
${diff}

## Instructions
- Flag security issues, type safety violations, and missing tests as high priority
- Use severity levels: Blocker, Major, Minor, Suggestion
- Be concise: one line per issue with file:line reference
- Output your review to stdout`;
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

/**
 * Ask the local `claude` CLI to review the current PR diff. Branch/PR/base are
 * derived from git + GitHub and the prompt is streamed via stdin (not argv) to
 * avoid "Argument list too long" failures on large PRs.
 */
export function solicitClaudeCodeReview(rootDir: string): number {
  const context = resolvePrContext();
  ensureChanges(context.baseRef);

  const diff = run("git", ["diff", `${context.baseRef}...HEAD`]);
  const prompt = buildReviewPrompt({
    context,
    diff,
    reviewInstructions: readReviewInstructions(rootDir),
  });

  const result = spawnSync("claude", ["--print"], {
    stdio: ["pipe", "inherit", "inherit"],
    input: prompt,
  });
  return spawnExitCode("claude", result);
}
