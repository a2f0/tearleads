---
name: cross-agent-review
description: Request code review from another AI agent (Claude Code or Codex)
---

# Cross-Agent Review

Request a code review from another AI agent. This enables Codex to solicit a review from Claude Code, or request a fresh self-review.

## Arguments

- First argument: Optional - `claude` or `codex` (defaults to `claude`, i.e. the other agent when invoked from Codex)

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

   - If argument is `codex`: use Codex (self-review)
   - Otherwise: use Claude Code (default for Codex invoking this skill)

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

   - If Claude review fails with a credit/quota style error (for example: `Credit balance is too low`, `quota`, `insufficient credits`), immediately fall back to self-review:

     ```bash
     "$AGENT_TOOL" solicitCodexReview
     ```

   - If Codex review also fails (or if Codex review was selected first and fails due to credits/quota/auth, or prompt size limits), perform an **in-session file-by-file review** (step 3).

   - Only stop immediately for non-credit operational errors (for example: missing PR, missing tool script, malformed args) where fallback is not possible.

3. **In-session file-by-file review** (when external agents are unavailable):

   **CRITICAL: Never compute the full PR diff in a single pass.** Large diffs exceed prompt limits and cause partial/failed reviews. Instead, use `agentTool` to interrogate GitHub and review file-by-file:

   a. Get PR metadata and changed files from GitHub:

      ```bash
      "$AGENT_TOOL" getPrInfo --fields number,baseRefName,headRefName,files
      ```

   b. For each changed file in the `files` array, get the per-file diff:

      ```bash
      git diff <baseRefName>...HEAD -- <file-path>
      ```

   c. Read each changed file with native file-reading tools to understand full context beyond the diff hunks.

   d. Review each file individually against `REVIEW.md` guidelines:
      - Flag security issues, type safety violations, and missing tests as high priority
      - Use severity levels: Blocker, Major, Minor, Suggestion
      - Be concise: one line per issue with file:line reference

   e. Aggregate findings across all files into the final review output.

4. **Tag the PR with the reviewer**: After a successful review, tag the PR with the agent that performed it:

   ```bash
   # Use the agent name that actually performed the review (claude, codex, etc.)
   # For in-session self-review, use "codex"
   "$AGENT_TOOL" tagPrWithReviewer --reviewer <agent>
   ```

   If fallback was used, tag with whichever agent's review succeeded.

5. **Report results**: Output the review results including:
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
- **In-session self-review uses `agentTool getPrInfo --fields files` to get the changed file list from GitHub**, then reviews per-file diffs individually to avoid prompt size limits
- Error output should be relayed verbatim when fallback is impossible
