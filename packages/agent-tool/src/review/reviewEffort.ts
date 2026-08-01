/**
 * Reasoning-effort levels accepted by the reviewer CLIs. `claude --effort`
 * documents exactly this set; `codex` takes the same names via its
 * `model_reasoning_effort` config key.
 */
export const REVIEW_EFFORT_LEVELS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ReviewEffort = (typeof REVIEW_EFFORT_LEVELS)[number];

/**
 * Per-agent defaults. Claude reviews at `xhigh`; Codex reviews at `high`, which
 * also pins the level rather than inheriting whatever `~/.codex/config.toml`
 * happens to set.
 */
export const DEFAULT_CLAUDE_EFFORT: ReviewEffort = "xhigh";
export const DEFAULT_CODEX_EFFORT: ReviewEffort = "high";

/**
 * Narrow an arbitrary string to a known effort level. Written as a type guard
 * over `some()` rather than `includes()` so the check needs no type assertion
 * (see the package-no-type-assertions lint).
 */
function isReviewEffort(value: string): value is ReviewEffort {
  return REVIEW_EFFORT_LEVELS.some((level) => level === value);
}

/**
 * Resolve a reviewer's effort level from the CLI argument, falling back to the
 * agent's default when none is given. Throws on an unknown level so a typo fails
 * fast here instead of surfacing as an opaque reviewer-CLI error.
 */
export function resolveReviewEffort(
  effortArg: string | undefined,
  fallback: ReviewEffort,
): ReviewEffort {
  const effort = (effortArg ?? "").trim();
  if (effort.length === 0) {
    return fallback;
  }
  if (!isReviewEffort(effort)) {
    throw new Error(
      `Unknown review effort '${effort}'. Use one of: ${REVIEW_EFFORT_LEVELS.join(", ")}.`,
    );
  }
  return effort;
}
