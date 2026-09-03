#!/usr/bin/env bun
/**
 * agent-tool - minimal CLI for cross-agent code review and PR workflows.
 *
 * Usage: bun packages/agent-tool/src/index.ts <action> [args]
 *   solicitClaudeCodeReview [effort]
 *                               Review the current branch's diff with the local
 *                               `claude` CLI — against the PR base, or the
 *                               default branch when no PR is open yet (effort
 *                               defaults to xhigh)
 *   solicitCodexReview [effort] Review the current branch's diff with the local
 *                               `codex` CLI — against the PR base, or the default
 *                               branch when no PR is open yet (effort defaults to
 *                               high)
 *
 *   effort levels: low | medium | high | xhigh | max
 *   openPr [title]              Open a PR for the current branch with a
 *                               commitlint-valid title (body from stdin)
 *   squashMerge [subject] [sha] [base-ref]
 *                               Squash-merge the current PR with a subject-only
 *                               commit (defaults to the PR title), appending the
 *                               `(#<pr>)` reference to the subject. Optional
 *                               [sha] binds the merge to the reviewed head;
 *                               [base-ref] rejects a retargeted PR before it.
 */
import { execFileSync } from "node:child_process";

import { runAgentToolAction } from "./runAgentToolAction";

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
}

function main(): number {
  const rootDir = repoRoot();
  process.chdir(rootDir);
  return runAgentToolAction(rootDir, process.argv.slice(2));
}

try {
  process.exit(main());
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}
