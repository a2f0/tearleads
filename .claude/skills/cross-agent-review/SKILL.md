---
name: cross-agent-review
description: Request code review from another AI agent (Claude Code or Codex)
---


# Cross-Agent Review

Request a code review from another AI agent. This enables Claude Code to solicit a review from Codex, or request a fresh self-review.

## Arguments

- First argument: Optional - `claude` or `codex` (defaults to `codex`, i.e. the other agent when invoked from Claude Code)

## Prerequisites

- The underlying scripts must exist: `./scripts/agents/tooling/agentTool.ts`
- For Claude Code reviews: Claude CLI must be authenticated
- For Codex reviews: `OPENAI_API_KEY` must be configured
- Run from the repository root, or resolve paths from `git rev-parse --show-toplevel`

## Setup

Verify we're on a PR branch:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
PR_NUMBER=$(gh pr list --head "$BRANCH" --state open --json number --jq '.[0].number' -R "$REPO" 2>/dev/null || echo "")
ROOT_DIR=$(git rev-parse --show-toplevel)
AGENT_TOOL="$ROOT_DIR/scripts/agents/tooling/agentTool.ts"
[ -f "$AGENT_TOOL" ] || { echo "Error: agentTool.ts not found at $AGENT_TOOL" >&2; exit 1; }
```

If `$BRANCH` is `main` or `$PR_NUMBER` is empty, report the error and stop.

## Workflow

1. **Determine agent**: Parse the argument:

   - If argument is `claude`: use Claude Code (self-review)
   - Otherwise: use Codex (default for Claude Code invoking this skill)

2. **Run the review**: Execute the appropriate agentTool command.

   **For Claude Code review**:

   ```bash
   "$AGENT_TOOL" solicitClaudeCodeReview
   ```

   **For Codex review**:

   ```bash
   "$AGENT_TOOL" solicitCodexReview
   ```

   **Credit/quota fallback behavior (required)**:

   - If Codex review fails with a credit/quota style error (for example: `Credit balance is too low`, `quota`, `insufficient credits`), immediately fall back to self-review:

     ```bash
     "$AGENT_TOOL" solicitClaudeCodeReview
     ```

   - If Claude Code review also fails (or if Claude Code review was selected first and fails due to nested session restrictions, credits/quota/auth), perform a manual self-review directly in-session:
     - Inspect the PR diff against base
     - Review for correctness, regressions, risks, and missing tests
     - Return concrete findings with file references

   - Only stop immediately for non-credit operational errors (for example: missing PR, missing tool script, malformed args) where fallback is not possible.

3. **Report results**: Output the review results including:
   - Which agent performed the review
   - The PR number and branch
   - The review findings
   - Whether fallback was used (and why)

## Use Cases

- **Fallback review**: When Gemini quota is exhausted, invoke Claude or Codex as a fallback
- **Second opinion**: Get a review from a different agent for validation
- **Self-review**: Request a fresh self-review

## Notes

- Both review scripts are non-interactive and output to stdout
- The scripts require an open PR on the current branch
- Reviews are based on the diff between the PR's base branch and HEAD
- Claude review derives branch/PR/base from git + GitHub and streams prompt/diff
  via stdin (not argv) to avoid "Argument list too long" failures on large PRs
- Error output should be relayed verbatim when fallback is impossible
