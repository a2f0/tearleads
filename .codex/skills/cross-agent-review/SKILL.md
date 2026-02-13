---
name: cross-agent-review
description: Request code review from another AI agent (Claude Code or Codex)
---

# Cross-Agent Review

Request a code review from another AI agent. This enables Codex to solicit a review from Claude Code, or request a fresh self-review.

## Arguments

- First argument: Optional - `claude` or `codex` (defaults to `claude` when invoked from Codex)

## Prerequisites

- The underlying scripts must exist: `./scripts/agents/tooling/agentTool.ts`
- For Claude Code reviews: Claude CLI must be authenticated
- For Codex reviews: `OPENAI_API_KEY` must be configured

## Setup

Verify we're on a PR branch:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
PR_NUMBER=$(gh pr list --head "$BRANCH" --state open --json number --jq '.[0].number' -R "$REPO" 2>/dev/null || echo "")
```

If `$BRANCH` is `main` or `$PR_NUMBER` is empty, report the error and stop.

## Workflow

1. **Determine agent**: Parse the argument:

   - If argument is `codex`: use Codex (self-review)
   - Otherwise: use Claude Code (default for Codex invoking this skill)

2. **Run the review**: Execute the appropriate agentTool command.

   **For Claude Code review**:

   ```bash
   ./scripts/agents/tooling/agentTool.ts solicitClaudeCodeReview
   ```

   **For Codex review**:

   ```bash
   ./scripts/agents/tooling/agentTool.ts solicitCodexReview
   ```

   If the command fails, report the error to the user and stop.

3. **Report results**: Output the review results including:
   - Which agent performed the review
   - The PR number and branch
   - The review findings

## Use Cases

- **Fallback review**: When Gemini quota is exhausted, invoke Claude or Codex as a fallback
- **Second opinion**: Get a review from a different agent for validation
- **Self-review**: Request a fresh self-review

## Notes

- Both review scripts are non-interactive and output to stdout
- The scripts require an open PR on the current branch
- Reviews are based on the diff between the PR's base branch and HEAD
