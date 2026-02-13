---
name: commit-and-push
description: Commit staged changes and push to the remote using conventional commits with GPG signing. Use when you need to commit and push work, create a PR if missing, and wait for Gemini review before addressing feedback.
---

# Commit and Push

Commit staged changes, push the branch, create a PR if needed, and handle initial Gemini review.

## Setup

Determine the repository for all `gh` commands:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
```

Always pass `-R "$REPO"` to `gh` commands.

## Workflow

1. Check branch:
   - If on `main`, create a new branch named for the change.
   - After creating/switching, update the VS Code title:

   ```bash
   ./scripts/agents/tooling/agentTool.ts setVscodeTitle
   ```

2. Analyze changes:
   - Run `git status` and `git diff --staged` to confirm what will be committed.
   - If tooling reports actions but `git status` shows no unexpected changes, proceed without asking about generated files.

3. Commit format:
   - Follow `CLAUDE.md` commit guidelines (conventional commits, GPG signed with 5s timeout, no co-author lines, no footers).
   - Do not bump versions here.

4. Push:
   - Push the current branch to the remote after the commit.
   - The pre-push hook runs full builds and tests; set a long timeout and do not assume timeouts mean failure.

5. Verify push completed:
   - Before proceeding to PR creation or Gemini follow-up, verify the push actually completed:

   ```bash
   BRANCH=$(git branch --show-current)
   git fetch origin "$BRANCH"
   [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/$BRANCH)" ] || echo "NOT PUSHED"
   ```

   - **Do NOT proceed to step 6 or 7 until verification passes.** Replying to Gemini with "Fixed in commit X" when X is not visible on remote creates confusion.

6. Open PR:
   - If no PR exists, create one with `gh pr create`.
   - Do not include auto-close keywords (`Closes`, `Fixes`, `Resolves`).
   - Use the Claude-style PR body format and include the evaluated agent id.
   - Avoid shell interpolation bugs in PR bodies: always build body content with a **single-quoted heredoc** and pass it via `--body-file` (or `--body "$(cat ...)"` only when no backticks/$/[] are present).

   Compute the agent id:

   ```bash
   AGENT_ID=$(basename "$(git rev-parse --show-toplevel)")
   ```

   PR body template (fill in real bullets, keep section order). Prefer this safe pattern:

   ```bash
   PR_BODY_FILE=$(mktemp)
   cat <<'EOF' > "$PR_BODY_FILE"
   ## Summary
   - <verb-led, concrete change>
   - <second concrete change if needed>

   ## Testing
   - <command run or "not run (reason)">

   ## Issue
   - #<issue-number>

   Agent: __AGENT_ID__
   EOF
   sed -i'' -e "s/__AGENT_ID__/${AGENT_ID}/g" "$PR_BODY_FILE"
   gh pr create ... --body-file "$PR_BODY_FILE"
   rm -f "$PR_BODY_FILE"
   ```

   If there is no associated issue, replace the `## Issue` section with:

   ```text
   ## Related
   - <link or short reference>
   ```

   - After creating the PR, run:
     - `./scripts/agents/tooling/agentTool.ts setVscodeTitle`
     - `./scripts/agents/tooling/agentTool.ts tagPrWithTuxedoInstance`

7. Wait for Gemini:
   - Wait 60 seconds for Gemini Code Assist to review.

8. Address feedback:
   - Run `/address-gemini-feedback` for unresolved comments.
   - Reply to Gemini with `./scripts/agents/tooling/agentTool.ts replyToGemini --number <pr> --comment-id <id> --commit <sha>` (not `gh pr review`).
   - Use `replyToComment` only for custom non-fix responses.

## Token Efficiency (CRITICAL)

**MANDATORY**: ALL git commit and push commands MUST redirect stdout to `/dev/null`. Failure to do this wastes thousands of tokens on hook output.

```bash
# CORRECT - always use these forms
git commit -S -m "message" >/dev/null
git push >/dev/null

# WRONG - NEVER run without stdout suppression
git commit -m "message"  # Burns 1000+ tokens on pre-commit output
git push                 # Burns 5000+ tokens on pre-push output
```

**Why this is non-negotiable**:

- Husky pre-commit hooks output lint results, type-check results
- Husky pre-push hooks run full test suites and builds
- A single unsuppressed `git push` can add 5,000+ lines to context
- Errors go to stderr, which `>/dev/null` preserves
