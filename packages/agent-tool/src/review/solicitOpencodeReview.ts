import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  MAX_BUFFER_BYTES,
  resolveReviewContext,
  spawnExitCode,
} from "../git/prContext";
import { withPinnedReviewInput } from "./pinnedReviewInput";
import {
  DEFAULT_OPENCODE_EFFORT,
  type ReviewEffort,
  resolveReviewEffort,
} from "./reviewEffort";
import { buildReviewPrompt, OPENCODE_ACCESS_NOTE } from "./reviewPrompt";
import { type ReviewerEnv, relayReviewWithRetry } from "./runReview";

/**
 * The model every opencode review runs under. Pinned so the review never
 * silently inherits whatever the ambient opencode config selects, and so the
 * fallback works when the *other* agents are out of credits but this provider
 * is not.
 */
const OPENCODE_MODEL = "deepseek/deepseek-v4-pro";

/**
 * Name of the read-only reviewer agent defined in the inline config. A
 * distinctive name keeps a same-named agent in the user's global config from
 * being shadowed or shadowing this one; `OPENCODE_CONFIG_CONTENT` has the
 * highest precedence among the non-managed config tiers anyway.
 */
const OPENCODE_REVIEW_AGENT = "tearleads-review";

/**
 * Map the shared effort vocabulary to a `--variant` deepseek-v4-pro accepts.
 * The skill's levels are `low | medium | high | xhigh | max`; this model's
 * variants are `low | medium | high | max`, so `xhigh` collapses onto `max`.
 */
export function resolveOpencodeVariant(
  effort: ReviewEffort,
): Exclude<ReviewEffort, "xhigh"> | "max" {
  return effort === "xhigh" ? "max" : effort;
}

/**
 * Inline opencode config (`OPENCODE_CONFIG_CONTENT`) that defines the reviewer
 * agent and its confinement. This is the hermetic substitute for opencode
 * having no per-run "safe mode": the agent gets deny rules for every
 * state-changing or exfiltrating tool, and reads outside its own (empty) cwd
 * are gated by `external_directory` to the snapshot alone.
 *
 * The snapshot path appears both as `mkdtempSync` wrote it and as `realpath`
 * resolves it, because on macOS the temp dir is a symlink (`/var` →
 * `/private/var`) and the model may pass either spelling; a denied spelling
 * only costs the model a retry, but both spellings allowed costs nothing.
 */
export function buildOpencodeInlineConfig(snapshotRoot: string): string {
  const normalized = path.resolve(snapshotRoot).replaceAll("\\", "/");
  const resolved = realpathSync(snapshotRoot).replaceAll("\\", "/");
  const externalDirectory: Record<string, string> = { "*": "deny" };
  for (const root of new Set([normalized, resolved])) {
    externalDirectory[`${root}/**`] = "allow";
  }
  return JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    agent: {
      [OPENCODE_REVIEW_AGENT]: {
        description:
          "Read-only reviewer confined to the immutable repository snapshot.",
        prompt:
          "You are a read-only code reviewer. Use only the read, glob, and grep tools; never modify files, run commands, or fetch anything.",
        model: OPENCODE_MODEL,
        permission: {
          edit: "deny",
          bash: "deny",
          question: "deny",
          skill: "deny",
          task: "deny",
          webfetch: "deny",
          websearch: "deny",
          external_directory: externalDirectory,
        },
      },
    },
  });
}

/**
 * Build the `opencode run` argv for a non-interactive review. The prompt goes
 * over stdin (opencode reads stdin when no message positional is given), so a
 * large diff never hits argv limits. `--pure` drops external plugins, and the
 * confinement itself lives in the inline config passed through the
 * environment: opencode has no per-run flag for permissions, and
 * `--dangerously-skip-permissions` would only *add* authority, never remove
 * it.
 */
export function buildOpencodeReviewArgs(variant: string): string[] {
  return [
    "run",
    "--model",
    OPENCODE_MODEL,
    "--variant",
    variant,
    "--agent",
    OPENCODE_REVIEW_AGENT,
    "--pure",
  ];
}

/**
 * How much stderr tail to relay when an opencode attempt fails outright.
 */
const TRANSCRIPT_TAIL_CHARS = 2000;

/**
 * Run `opencode run` over an already-built review prompt and relay whatever it
 * prints to stdout — the final message alone, since run mode keeps its TUI
 * noise on stderr. Exit codes and the verdict gate behave exactly like the
 * Claude and Codex paths: a nonzero CLI exit is returned as-is, and an exit-0
 * run without a verdict-signed review is retried once before failing.
 *
 * Both streams are captured: opencode prints its session transcript — tool
 * call echo, progress lines, and the like — to stderr, and inheriting it
 * would bury the review under noise on every run. On a failed launch the
 * stderr tail is relayed so the error is still diagnosable (the Codex path
 * makes the same trade-off).
 *
 * The reviewer runs from a fresh, empty, non-repository cwd so nothing
 * branch-controlled loads: not the snapshot's `AGENTS.md` or `opencode.json`,
 * and not its `.opencode/` directory. `OPENCODE_CONFIG_DIR` points at that
 * same empty directory so no user-defined agents, commands, or plugins from
 * `~/.config/opencode` ride along either; `--pure` additionally disables
 * external plugins. That directory is *config* only: opencode's credentials
 * live in its data directory (`~/.local/share/opencode/auth.json` on macOS),
 * which `OPENCODE_CONFIG_DIR` does not touch, so the deepseek auth the review
 * needs still resolves. Global config still loads, but the inline config's
 * agent-scoped deny rules take precedence over whatever it sets.
 */
export function spawnOpencodeReview(
  prompt: string,
  effort: ReviewEffort,
  snapshotRoot: string,
  env: ReviewerEnv = process.env,
): number {
  const outDir = mkdtempSync(path.join(tmpdir(), "agent-tool-opencode-"));
  try {
    return relayReviewWithRetry("opencode", () => {
      const result = spawnSync(
        "opencode",
        buildOpencodeReviewArgs(resolveOpencodeVariant(effort)),
        {
          stdio: ["pipe", "pipe", "pipe"],
          input: prompt,
          encoding: "utf8",
          maxBuffer: MAX_BUFFER_BYTES,
          // Neutral cwd: opencode would otherwise load the snapshot's
          // branch-controlled config and instructions into the reviewer.
          cwd: outDir,
          env: {
            ...env,
            OPENCODE_CONFIG_CONTENT: buildOpencodeInlineConfig(snapshotRoot),
            OPENCODE_CONFIG_DIR: outDir,
          },
        },
      );
      const exitCode = spawnExitCode("opencode", result);
      const transcript = result.stderr ?? "";
      if (exitCode !== 0 && transcript.length > 0) {
        process.stderr.write(
          `opencode transcript (tail):\n${transcript.slice(-TRANSCRIPT_TAIL_CHARS)}\n`,
        );
      }
      return {
        exitCode,
        review: result.stdout ?? "",
      };
    });
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

/**
 * Ask the local `opencode` CLI to review the current branch's diff with
 * deepseek-v4-pro. Branch/PR/base are derived from git + GitHub; when the
 * branch has no PR yet the diff is taken against the default branch, so a
 * review can run before the PR is opened. The prompt is streamed via stdin
 * (not argv) to avoid "Argument list too long" failures on large PRs. The
 * effort level defaults to `high` for opencode.
 */
export function solicitOpencodeReview(
  rootDir: string,
  effortArg?: string,
): number {
  const effort = resolveReviewEffort(effortArg, DEFAULT_OPENCODE_EFFORT);
  const context = resolveReviewContext();
  return withPinnedReviewInput(rootDir, context, (input) => {
    const prompt = buildReviewPrompt({
      context,
      diff: input.diff,
      reviewInstructions: input.reviewInstructions,
      accessNote: OPENCODE_ACCESS_NOTE,
      repositoryRoot: input.snapshotRoot,
    });

    return spawnOpencodeReview(prompt, effort, input.snapshotRoot);
  });
}
