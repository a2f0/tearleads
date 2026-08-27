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
 *                               [sha] and [base-ref] bind the merge to the
 *                               reviewed head and validated target branch.
 */
import { execFileSync } from "node:child_process";

import { openPr } from "./pr/openPr";
import { squashMerge } from "./pr/squashMerge";
import { solicitClaudeCodeReview } from "./review/solicitClaudeCodeReview";
import { solicitCodexReview } from "./review/solicitCodexReview";

const USAGE =
  "Usage: agent-tool <solicitClaudeCodeReview|solicitCodexReview|openPr|squashMerge> [args]\n";

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
}

function main(): number {
  const action = process.argv[2];
  const rootDir = repoRoot();
  process.chdir(rootDir);

  switch (action) {
    case "solicitClaudeCodeReview":
      return solicitClaudeCodeReview(rootDir, process.argv[3]);
    case "solicitCodexReview":
      return solicitCodexReview(rootDir, process.argv[3]);
    case "openPr":
      return openPr(rootDir, process.argv[3]);
    case "squashMerge":
      return squashMerge(
        rootDir,
        process.argv[3],
        process.argv[4],
        process.argv[5],
      );
    default:
      process.stderr.write(`Unknown action: ${action ?? "(none)"}\n${USAGE}`);
      return 1;
  }
}

try {
  process.exit(main());
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}
