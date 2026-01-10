---
description: Commit staged changes and push to remote using conventional commits
---

# Commit and Push

Commit and push the current changes following these rules:

1. **Check branch**: If on `main`, create a new branch with an appropriate name based on the changes. After creating or switching branches, update the VS Code title:

   ```bash
   setVscodeTitle.sh
   ```

2. **Analyze changes**: Run `git status` and `git diff --staged` to understand what's being committed.

3. **Commit format**: Follow `CLAUDE.md` guidelines (conventional commits, GPG signed with 5s timeout, no co-author/footers, no binary files). Don't bump versions - that happens in `/enter-merge-queue`.

4. **Push**: After successful commit, push to the current branch's remote.

5. **Open PR**: If no PR exists for this branch, create one with `gh pr create`. Include `Closes #<issue-number>` in the body if tracking an issue. Include agent tracking: `Agent: $(basename "$(git rev-parse --show-toplevel)")` at the bottom. After creating, run `setVscodeTitle.sh`.

6. **Wait for Gemini**: Wait 60 seconds for Gemini Code Assist to review.

7. **Address feedback**: Run `/address-gemini-feedback` to handle unresolved comments.

   **IMPORTANT**: When replying to Gemini comments, use the REST API (`gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_database_id}/replies`), NOT `gh pr review`. The `gh pr review` command creates pending/draft reviews that Gemini cannot see until submitted.

8. **Merge**: Run `/enter-merge-queue` to automate merging (updates from base, fixes CI, bumps versions, waits for merge).

## Token Efficiency

Minimize token consumption from git hook output:

- **Suppress stdout on git operations**: Pre-push hooks run linting, builds, and tests that produce verbose stdout. Redirect stdout to `/dev/null` while preserving stderr for errors:

  ```bash
  git commit -S -m "message" >/dev/null
  git push >/dev/null
  ```

- **Only stderr matters**: On success, the exit code is sufficient. On failure, errors appear on stderr which is preserved by the redirect.
