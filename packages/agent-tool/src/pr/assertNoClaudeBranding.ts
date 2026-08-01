/**
 * Branding signatures that Claude Code injects into commit/PR footers. These
 * target the attribution itself -- the "Generated with Claude Code" line, its
 * claude.com/claude-code and claude.ai/code links, and Claude co-author
 * trailers -- not every prose mention of the words, so a PR that legitimately
 * documents the repo's own Claude tooling is not blocked.
 */
const CLAUDE_BRANDING_PATTERNS: ReadonlyArray<{
  readonly label: string;
  readonly pattern: RegExp;
}> = [
  {
    label:
      "Claude Code attribution link (claude.com/claude-code or claude.ai/code)",
    pattern: /claude\.(?:com\/claude-code|ai\/code)/i,
  },
  {
    label: '"Generated with Claude Code" attribution',
    pattern: /generated\s+with\s+\[?\s*claude\s+code/i,
  },
  {
    label: "Co-authored-by Claude trailer",
    pattern: /co-authored-by:\s*claude\b/i,
  },
  {
    label: "Anthropic no-reply co-author address (noreply@anthropic.com)",
    pattern: /\bnoreply@anthropic\.com\b/i,
  },
];

/**
 * Reject a PR body that carries Claude Code branding. The pre-push hook already
 * strips Co-authored-by trailers from commits; this applies the same policy to
 * PR descriptions, where memory and prompt guidance alone have not held. Throws
 * with the matched signals when branding is present; returns silently otherwise.
 */
export function assertNoClaudeBranding(body: string): void {
  const matched = CLAUDE_BRANDING_PATTERNS.filter(({ pattern }) =>
    pattern.test(body),
  );
  if (matched.length === 0) {
    return;
  }

  const labels = matched.map(({ label }) => `  - ${label}`).join("\n");
  throw new Error(
    `PR body contains Claude Code branding:\n${labels}\n\n` +
      "Remove every Claude Code attribution line, co-author trailer, and " +
      "claude.com/claude-code or claude.ai/code link from the PR description, " +
      "then re-run open-pr.",
  );
}
