---
description: Request code review from another AI agent (Codex or Claude Code)
---

# Cross-Agent Review

Request a code review from another AI agent. This enables one agent (e.g., Claude Code) to solicit a review from another agent (e.g., Codex), or request a fresh self-review.

## Arguments

- `$ARGUMENTS` - Optional: `codex` or `claude` (defaults to `codex`, i.e. the other agent when invoked from Claude Code)

## Prerequisites

- The underlying scripts must exist: `./scripts/agents/tooling/agentTool.ts`
- For Codex reviews: `OPENAI_API_KEY` must be configured
- For Claude Code reviews: Claude CLI must be authenticated
- Run from the repository root, or resolve paths from `git rev-parse --show-toplevel`

## Steps

1. **Get PR info**: Verify we're on a PR branch:

   ```bash
   BRANCH=$(git rev-parse --abbrev-ref HEAD)
   REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
   PR_NUMBER=$(gh pr list --head "$BRANCH" --state open --json number --jq '.[0].number' -R "$REPO" 2>/dev/null || echo "")
   ROOT_DIR=$(git rev-parse --show-toplevel)
   AGENT_TOOL="$ROOT_DIR/scripts/agents/tooling/agentTool.ts"
   [ -f "$AGENT_TOOL" ] || { echo "Error: agentTool.ts not found at $AGENT_TOOL" >&2; exit 1; }
   ```

   If `$BRANCH` is `main` or `$PR_NUMBER` is empty, report the error and stop.

2. **Determine agent**: Parse the argument:

   - If `$ARGUMENTS` is `claude`: use Claude Code
   - Otherwise: use Codex (default)

3. **Run the review**: Execute the appropriate agentTool command.

   **For Codex review**:

   ```bash
   "$AGENT_TOOL" solicitCodexReview
   ```

   **For Claude Code review**:

   ```bash
   "$AGENT_TOOL" solicitClaudeCodeReview
   ```

   If the command fails, report the error to the user and stop.

4. **Report results**: Output the review results to the user. Include:
   - Which agent performed the review
   - The PR number and branch
   - The review findings

## Use Cases

- **Fallback review**: When Gemini quota is exhausted, invoke Codex or Claude as a fallback
- **Second opinion**: Get a review from a different agent for validation
- **Self-review**: Claude can request a fresh self-review

## Notes

- Both review scripts are non-interactive and output to stdout
- The scripts require an open PR on the current branch
- Reviews are based on the diff between the PR's base branch and HEAD
- Error output should be relayed verbatim to the user before stopping
