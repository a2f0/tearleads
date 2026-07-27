import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  ensureChanges,
  MAX_BUFFER_BYTES,
  resolveReviewContext,
  run,
  spawnExitCode,
} from "./prContext";
import {
  DEFAULT_CODEX_EFFORT,
  type ReviewEffort,
  resolveReviewEffort,
} from "./reviewEffort";
import {
  buildReviewPrompt,
  CODEX_ACCESS_NOTE,
  readReviewInstructions,
} from "./reviewPrompt";
import { type ReviewerEnv, relayReviewWithRetry } from "./runReview";

/** How much transcript tail to relay when a codex attempt fails outright. */
const TRANSCRIPT_TAIL_CHARS = 2000;

/**
 * Build the `codex exec` argv. `exec`, not `review`: `codex review` writes its
 * own prompt, so it carries no verdict line to gate on and interleaves its
 * findings with an investigative transcript. `exec` takes this repo's prompt —
 * the same verdict-gated one Claude reviews under — reading it from stdin
 * (`-`) to dodge argv limits. The sandbox is pinned read-only (the prompt is a
 * PR diff — attacker-influenceable text — and a review needs no writes), the
 * effort is pinned so the review never silently inherits
 * `~/.codex/config.toml`, and the final message is written alone to
 * `lastMessageFile`, so what gets relayed is the review, not the transcript.
 *
 * `--ignore-user-config` keeps the session hermetic. The sandbox confines only
 * model-generated shell commands, so MCP servers configured in
 * `~/.codex/config.toml` would still load and could mutate external state on
 * behalf of that attacker-influenceable diff — and `-c mcp_servers={}` cannot
 * remove them, since table overrides merge instead of replacing (verified
 * against codex 0.145: `codex mcp list` is unchanged under that override).
 * Ignoring the user config drops those servers wholesale; auth still works,
 * and everything the review needs is pinned explicitly right here.
 * `--disable plugins/hooks/apps` closes the remaining gaps: plugin-provided
 * MCP servers, trusted hooks, and app connectors all live outside
 * `config.toml`, so ignoring the config alone would leave them active.
 */
export function buildCodexReviewArgs(
  effort: ReviewEffort,
  lastMessageFile: string,
): string[] {
  return [
    "exec",
    "--ignore-user-config",
    "--disable",
    "plugins",
    "--disable",
    "hooks",
    "--disable",
    "apps",
    "--sandbox",
    "read-only",
    "-c",
    `model_reasoning_effort="${effort}"`,
    "--color",
    "never",
    "--output-last-message",
    lastMessageFile,
    "-",
  ];
}

/** Content of the last-message file, or "" when codex never wrote one. */
function readLastMessage(lastMessageFile: string): string {
  try {
    return readFileSync(lastMessageFile, "utf8");
  } catch {
    return "";
  }
}

/**
 * Run `codex exec` over an already-built review prompt and relay the final
 * message it writes.
 *
 * The review is read from `--output-last-message`, not the process streams:
 * codex prints its session transcript — including a verbatim echo of the
 * prompt and diff — to stderr and the final message to stdout, and inheriting
 * either would bury the verdict in noise (the exact failure this replaces).
 * Both streams are captured; on a failed launch the stderr tail is relayed so
 * the error is still diagnosable. Degenerate exit-0 output is retried once via
 * the shared gate, same as the Claude path.
 */
export function spawnCodexReview(
  prompt: string,
  effort: ReviewEffort,
  env: ReviewerEnv = process.env,
): number {
  const outDir = mkdtempSync(path.join(tmpdir(), "agent-tool-codex-"));
  let attempt = 0;
  try {
    return relayReviewWithRetry("codex", () => {
      // A fresh file per attempt, so a retry that crashes before writing can
      // never be read as the previous attempt's stale message.
      attempt += 1;
      const lastMessageFile = path.join(outDir, `review-${attempt}.md`);
      const result = spawnSync(
        "codex",
        buildCodexReviewArgs(effort, lastMessageFile),
        {
          stdio: ["pipe", "pipe", "pipe"],
          input: prompt,
          encoding: "utf8",
          maxBuffer: MAX_BUFFER_BYTES,
          env,
        },
      );
      const exitCode = spawnExitCode("codex", result);
      const transcript = result.stderr ?? "";
      if (exitCode !== 0 && transcript.length > 0) {
        process.stderr.write(
          `codex transcript (tail):\n${transcript.slice(-TRANSCRIPT_TAIL_CHARS)}\n`,
        );
      }
      return { exitCode, review: readLastMessage(lastMessageFile) };
    });
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

/**
 * Ask the local `codex` CLI to review the current branch's diff. Branch/PR/base
 * are derived from git + GitHub; when the branch has no PR yet the diff is
 * taken against the default branch, so a review can run before the PR is
 * opened. The effort level defaults to `high` for Codex.
 */
export function solicitCodexReview(
  rootDir: string,
  effortArg?: string,
): number {
  const effort = resolveReviewEffort(effortArg, DEFAULT_CODEX_EFFORT);
  const context = resolveReviewContext();
  ensureChanges(context.baseRef);

  const diff = run("git", ["diff", `${context.baseRef}...HEAD`]);
  const prompt = buildReviewPrompt({
    context,
    diff,
    reviewInstructions: readReviewInstructions(rootDir),
    accessNote: CODEX_ACCESS_NOTE,
  });

  return spawnCodexReview(prompt, effort);
}
