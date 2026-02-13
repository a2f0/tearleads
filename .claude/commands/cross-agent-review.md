---
description: Request code review from another AI agent (Codex or Claude Code)
---

# Cross-Agent Review

Request a code review from another AI agent. This enables one agent (e.g., Claude Code) to solicit a review from another agent (e.g., Codex), or to invoke a fresh review from itself.

## Arguments

- `$ARGUMENTS` - Optional: `codex` or `claude` (defaults to `codex`)

## Steps

1. **Get PR info**: Verify we're on a PR branch:

   ```bash
   # Get current branch
   BRANCH=$(git rev-parse --abbrev-ref HEAD)

   if [ "$BRANCH" = "main" ]; then
     echo "Error: Cannot review main branch. Checkout a PR branch first."
     exit 1
   fi

   # Get repo
   REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

   # Get PR number
   PR_NUMBER=$(gh pr list --head "$BRANCH" --state open --json number --jq '.[0].number' -R "$REPO" 2>/dev/null || echo "")
   ```

   If no PR exists, report the error and stop.

2. **Determine agent**: Parse the argument:

   - If `$ARGUMENTS` is empty or `codex`: use Codex
   - If `$ARGUMENTS` is `claude`: use Claude Code
   - Otherwise: report invalid argument and stop

3. **Run the review**:

   **For Codex review**:

   ```bash
   ./scripts/agents/tooling/agentTool.ts solicitCodexReview
   ```

   **For Claude Code review**:

   ```bash
   ./scripts/agents/tooling/agentTool.ts solicitClaudeCodeReview
   ```

4. **Report results**: Output the review results to the user. Include:
   - Which agent performed the review
   - The PR number and branch
   - The review findings

## Use Cases

- **Fallback review**: When Gemini quota is exhausted, invoke Codex or Claude as a fallback
- **Second opinion**: Get a review from a different agent for validation
- **Self-review**: Claude can invoke itself for a fresh review perspective

## Notes

- Both review scripts are non-interactive and output to stdout
- The scripts require an open PR on the current branch
- Reviews are based on the diff between the PR's base branch and HEAD
