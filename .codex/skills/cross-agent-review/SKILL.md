---
name: cross-agent-review
description: Request a code review of the current PR from another AI agent (Codex by default, or a fresh Claude Code self-review)
---

# Cross-Agent Review

Request a code review of the current PR from another AI agent. Invoked from
Claude Code, this solicits a review from Codex by default, or a fresh Claude
Code self-review. Falls back to an in-session review when no external agent is
available.

## Arguments

- First argument (optional): `claude` or `codex`. Defaults to `codex` (the
  other agent when invoked from Claude Code).
- Second argument (optional): the reviewer's reasoning **effort level** — one of
  `low`, `medium`, `high`, `xhigh`, `max`. When omitted it defaults **per agent**:
  **`xhigh` for Claude**, **`high` for Codex**. An unknown level fails fast
  before the reviewer CLI is launched.

  The level is passed as `claude --effort <level>` and, for Codex, as
  `-c model_reasoning_effort="<level>"` — an explicit override, so a Codex review
  never silently inherits whatever `~/.codex/config.toml` sets.

## Prerequisites

- `git` and `gh` (authenticated) on `PATH`.
- The `@tearleads/agent-tool` package: `packages/agent-tool/src/index.ts`.
- For Codex reviews: `codex` CLI configured (`OPENAI_API_KEY`).
- For Claude Code reviews: `claude` CLI authenticated.
- An open PR on the current branch.

## Setup

Resolve the branch, repo, PR, and tool path:

```bash
ROOT_DIR=$(git rev-parse --show-toplevel)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
PR_NUMBER=$(gh pr list --head "$BRANCH" --state open --json number --jq '.[0].number' -R "$REPO" 2>/dev/null || echo "")
AGENT_TOOL="$ROOT_DIR/packages/agent-tool/src/index.ts"
[ -f "$AGENT_TOOL" ] || { echo "Error: agent-tool not found at $AGENT_TOOL" >&2; exit 1; }
```

If `$BRANCH` is `main` or `$PR_NUMBER` is empty, report the error and stop.

## Workflow

1. **Determine agent**: Parse the argument:
   - `claude` → Claude Code (self-review)
   - otherwise → Codex (default for Claude Code invoking this skill)

2. **Run the review**: Execute the matching action. Omit the effort argument to
   take the per-agent default (`xhigh` for Claude, `high` for Codex); pass a
   level to override it.

   **For Codex review:**

   ```bash
   bun "$AGENT_TOOL" solicitCodexReview            # effort: high (default)
   bun "$AGENT_TOOL" solicitCodexReview xhigh      # explicit override
   ```

   **For Claude Code review:**

   ```bash
   bun "$AGENT_TOOL" solicitClaudeCodeReview       # effort: xhigh (default)
   bun "$AGENT_TOOL" solicitClaudeCodeReview high  # explicit override
   ```

   **Fallback behavior (required):**

   - If the Codex review fails for **any** reason (credit/quota errors,
     non-zero exit, signal termination), immediately fall back to a Claude Code
     self-review:

     ```bash
     bun "$AGENT_TOOL" solicitClaudeCodeReview
     ```

   - If the Claude Code review also fails (or was selected first and fails due
     to nested-session restrictions, credits/quota/auth, or prompt-size limits),
     perform an **in-session file-by-file review** (step 3).

   - Only stop immediately for non-recoverable operational errors (missing PR,
     missing tool script, malformed args) where fallback would also fail.

3. **In-session file-by-file review** (when external agents are unavailable):

   **CRITICAL: Never compute the full PR diff in a single pass.** Large diffs
   exceed prompt limits and cause partial/failed reviews. Interrogate GitHub and
   review file-by-file:

   a. Get the base ref and changed files:

      ```bash
      gh pr view "$PR_NUMBER" --json baseRefName,files -R "$REPO"
      ```

   b. For each changed file, get the per-file diff:

      ```bash
      git diff <baseRefName>...HEAD -- <file-path>
      ```

   c. For added or modified files, read the file with the Read tool for full
      context. Deleted files do not need to be read.

   d. Review each file against the project's guidelines (`REVIEW.md` if present,
      otherwise `AGENTS.md` and `CLAUDE.md`):
      - Flag security issues, type safety violations, and missing tests as high
        priority.
      - Use severity levels: Blocker, Major, Minor, Suggestion.
      - Be concise: one line per issue with a `file:line` reference.

   e. Aggregate findings across all files into the final review output.

4. **Report results**: Output the review including:
   - Which agent performed the review (and whether fallback was used, and why)
   - The PR number and branch
   - The review findings

## Notes

- Effort defaults are per agent — `xhigh` for Claude, `high` for Codex — and are
  always passed explicitly, so neither reviewer inherits an ambient config value.
  Fallback reviews use the fallback agent's own default unless a level is given.
- The review scripts are non-interactive and stream output to stdout.
- Reviews are based on the diff between the PR's base branch and HEAD.
- The Claude review streams the prompt/diff via stdin (not argv) to avoid
  "Argument list too long" failures on large PRs.
- Error output should be relayed verbatim when fallback is impossible.
