#!/usr/bin/env bun
/**
 * agent-tool - minimal CLI for cross-agent code review and PR squash-merge.
 *
 * Usage: bun packages/agent-tool/src/index.ts <action> [args]
 *   solicitClaudeCodeReview     Review the current PR with the local `claude` CLI
 *   solicitCodexReview          Review the current PR with the local `codex` CLI
 *   squashMerge [subject]       Squash-merge the current PR with a subject-only
 *                               commit (defaults to the PR title)
 */
import { execFileSync } from "node:child_process";

import { solicitClaudeCodeReview } from "./solicitClaudeCodeReview";
import { solicitCodexReview } from "./solicitCodexReview";
import { squashMerge } from "./squashMerge";

const USAGE =
  "Usage: agent-tool <solicitClaudeCodeReview|solicitCodexReview|squashMerge> [args]\n";

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
      return solicitClaudeCodeReview(rootDir);
    case "solicitCodexReview":
      return solicitCodexReview();
    case "squashMerge":
      return squashMerge(rootDir, process.argv[3]);
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
