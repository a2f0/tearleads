---
description: Commit staged changes and push to remote using conventional commits
---

# Commit and Push

**First**: Determine the repository for all `gh` commands:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
```

Use `-R "$REPO"` with all `gh` commands in this skill.

Commit and push the current changes following these rules:

1. **Check branch**: If on `main`, create a new branch with an appropriate name based on the changes. After creating or switching branches, update the VS Code title:

   ```bash
   setVscodeTitle.sh
   ```

2. **Analyze changes**: Run `git status` and `git diff --staged` to understand what's being committed.
   - If tooling reports actions (e.g., postinstall builds) but `git status` shows no unexpected changes, continue without stopping.

3. **Commit format**: Follow `CLAUDE.md` guidelines (conventional commits, GPG signed with 5s timeout, no co-author/footers, no binary files). Don't bump versions - that happens in `/enter-merge-queue`.

4. **Push**: After successful commit, push to the current branch's remote.

5. **Open PR**: If no PR exists for this branch, create one with `gh pr create`. Include `Closes #<issue-number>` in the body if tracking an issue. Include agent tracking: `Agent: $(basename "$(git rev-parse --show-toplevel)")` at the bottom. After creating, run `setVscodeTitle.sh`.

6. **Wait for Gemini**: Wait 60 seconds for Gemini Code Assist to review.

7. **Address feedback**: Run `/address-gemini-feedback` to handle unresolved comments.

   **IMPORTANT**: When replying to Gemini comments, use the REST API (`gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_database_id}/replies`), NOT `gh pr review`. The `gh pr review` command creates pending/draft reviews that Gemini cannot see until submitted. **Always include `@gemini-code-assist` in your reply** to ensure Gemini receives a notification.

## Token Efficiency (CRITICAL - DO NOT SKIP)

**MANDATORY**: ALL git commit and push commands MUST redirect stdout to `/dev/null`. Failure to do this wastes thousands of tokens on hook output.

### Required pattern for ALL git operations

```bash
# CORRECT - always use these forms
git commit -S -m "message" >/dev/null
git push >/dev/null

# WRONG - NEVER run without stdout suppression
git commit -m "message"  # Burns 1000+ tokens on pre-commit output
git push                 # Burns 5000+ tokens on pre-push output
```

### Why this is non-negotiable

- Husky pre-commit hooks output lint results, type-check results
- Husky pre-push hooks run full test suites and builds
- A single unsuppressed `git push` can add 5,000+ lines to context
- This is pure waste - on success, only exit code matters
- Errors go to stderr, which `>/dev/null` preserves
