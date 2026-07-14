#!/usr/bin/env bun
/**
 * agent-tool - minimal CLI for cross-agent code review.
 *
 * Usage: bun packages/agent-tool/src/index.ts <action>
 *   solicitClaudeCodeReview   Review the current PR with the local `claude` CLI
 *   solicitCodexReview        Review the current PR with the local `codex` CLI
 */
import { execFileSync } from "node:child_process";

import { solicitClaudeCodeReview } from "./solicitClaudeCodeReview";
import { solicitCodexReview } from "./solicitCodexReview";

const USAGE =
  "Usage: agent-tool <solicitClaudeCodeReview|solicitCodexReview>\n";

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
