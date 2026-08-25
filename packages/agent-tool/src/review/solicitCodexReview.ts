import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  MAX_BUFFER_BYTES,
  resolveReviewContext,
  spawnExitCode,
} from "../git/prContext";
import { withPinnedReviewInput } from "./pinnedReviewInput";
import {
  DEFAULT_CODEX_EFFORT,
  type ReviewEffort,
  resolveReviewEffort,
} from "./reviewEffort";
import { buildReviewPrompt, CODEX_ACCESS_NOTE } from "./reviewPrompt";
import { type ReviewerEnv, relayReviewWithRetry } from "./runReview";

/** How much transcript tail to relay when a codex attempt fails outright. */
const TRANSCRIPT_TAIL_CHARS = 2000;

/**
 * Build the `codex exec` argv. `exec`, not `review`: `codex review` writes its
 * own prompt, so it carries no verdict line to gate on and interleaves its
 * findings with an investigative transcript. `exec` takes this repo's prompt —
 * the same verdict-gated one Claude reviews under — reading it from stdin
 * (`-`) to dodge argv limits. A custom permission profile denies the host
 * filesystem by default and exposes only the immutable review snapshot plus
 * Codex's minimal runtime paths. The effort is pinned so the review never
 * silently inherits `~/.codex/config.toml`, and the final message is written
 * alone to `lastMessageFile`, so what gets relayed is the review, not the
 * transcript.
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
 * `config.toml`, so ignoring the config alone would leave them active. Hosted
 * web search is disabled separately because it is not governed by the sandbox
 * network permission.
 * Codex also runs ephemerally from a temporary non-repository cwd so
 * branch-controlled AGENTS.md files are not injected into its prompt. Model
 * commands inherit no host environment, and strict config validation makes an
 * unsupported permission profile fail closed.
 */
export function buildCodexReviewArgs(
  effort: ReviewEffort,
  lastMessageFile: string,
  snapshotRoot: string,
  codexRuntimeRoot: string,
): string[] {
  const readableRoots = [...new Set([codexRuntimeRoot, snapshotRoot])];
  const filesystemPermissions = [
    '":root"="deny"',
    '":minimal"="read"',
    ...readableRoots.map((root) => `${JSON.stringify(root)}="read"`),
  ];
  return [
    "exec",
    "--ignore-user-config",
    "--ignore-rules",
    "--strict-config",
    "--ephemeral",
    "--disable",
    "plugins",
    "--disable",
    "hooks",
    "--disable",
    "apps",
    "--skip-git-repo-check",
    "-c",
    `model_reasoning_effort="${effort}"`,
    "-c",
    'web_search="disabled"',
    "-c",
    'default_permissions="review-snapshot"',
    "-c",
    `permissions.review-snapshot.filesystem={${filesystemPermissions.join(",")}}`,
    "-c",
    "permissions.review-snapshot.network.enabled=false",
    "-c",
    'shell_environment_policy.inherit="none"',
    "--color",
    "never",
    "--output-last-message",
    lastMessageFile,
    "-",
  ];
}

function resolveCodexExecutable(env: ReviewerEnv): string {
  const { PATH: pathValue } = env;
  if (pathValue === undefined) {
    return "codex";
  }
  for (const pathEntry of pathValue.split(path.delimiter)) {
    const candidate = path.resolve(pathEntry || ".", "codex");
    try {
      accessSync(candidate, constants.X_OK);
      return realpathSync(candidate);
    } catch {
      // Continue through PATH exactly as the process launcher would.
    }
  }
  return "codex";
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
  snapshotRoot: string,
  env: ReviewerEnv = process.env,
): number {
  const outDir = mkdtempSync(path.join(tmpdir(), "agent-tool-codex-"));
  const codexExecutable = resolveCodexExecutable(env);
  const codexRuntimeRoot = path.dirname(codexExecutable);
  let attempt = 0;
  try {
    return relayReviewWithRetry("codex", () => {
      // A fresh file per attempt, so a retry that crashes before writing can
      // never be read as the previous attempt's stale message.
      attempt += 1;
      const lastMessageFile = path.join(outDir, `review-${attempt}.md`);
      const result = spawnSync(
        codexExecutable,
        buildCodexReviewArgs(
          effort,
          lastMessageFile,
          snapshotRoot,
          codexRuntimeRoot,
        ),
        {
          stdio: ["pipe", "pipe", "pipe"],
          input: prompt,
          encoding: "utf8",
          maxBuffer: MAX_BUFFER_BYTES,
          // Codex loads project AGENTS.md from its cwd. Keep cwd neutral and
          // grant read-only access to the reviewed repository explicitly.
          cwd: outDir,
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
  return withPinnedReviewInput(rootDir, context, (input) => {
    const prompt = buildReviewPrompt({
      context,
      diff: input.diff,
      reviewInstructions: input.reviewInstructions,
      accessNote: CODEX_ACCESS_NOTE,
      repositoryRoot: input.snapshotRoot,
    });

    return spawnCodexReview(prompt, effort, input.snapshotRoot);
  });
}
