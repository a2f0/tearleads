---
description: Commit staged changes and push to remote using conventional commits
---

# Commit and Push

Commit and push the current changes following these rules:

1. **Check branch**: If on `main`, create a new branch with an appropriate name based on the changes. After creating or switching branches, update the VS Code title:

   ```bash
   ./scripts/agents/setVscodeTitle.sh
   ```

2. **Analyze changes**: Run `git status` and `git diff --staged` to understand what's being committed.

3. **Conventional commit format**:
   - Subject line: `<type>(<scope>): <description>` (max 50 chars)
   - Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`, `build`
   - Scope: prefer feature-based (`pwa`, `auth`, `settings`) over package-based when possible
   - Description should be imperative mood ("add" not "added")
   - Body can contain detailed explanation (wrap at 72 chars)

4. **DO NOT**:
   - Add `Co-Authored-By` headers
   - Add emoji or "Generated with Claude Code" footers
   - Use `--no-gpg-sign` or skip signing
   - Commit binary files (PNG, JPG, ICO, etc.) - use SVG for icons/badges or external URLs

5. **GPG signing**: The commit MUST be signed. Use a 5-second timeout. For multi-line messages, pipe the content to `git commit`:

   ```bash
   printf "subject\n\nbody" | timeout 5 git commit -S -F -
   ```

6. **Push**: After successful commit, push to the current branch's remote.

7. **Open PR**: If a PR doesn't already exist for this branch, create one using `gh pr create`. Skip if already on `main` or PR exists.

   **Important**: If you created a GitHub issue to track this work, include `Closes #<issue-number>` in the PR body to auto-close the issue when merged. To close multiple issues, you can list them (e.g., `Closes #123, #456`):

   ```bash
   gh pr create --title "<type>(<scope>): <description>" --body "$(cat <<'EOF'
   ## Summary
   - Brief description of changes

   Closes #<issue-number>
   EOF
   )"
   ```

   After creating a PR, update the VS Code title to show the PR number:

   ```bash
   ./scripts/agents/setVscodeTitle.sh
   ```

8. **Wait for Gemini feedback**: After the push completes (and PR is created/updated), wait 60 seconds for Gemini Code Assist to post its review comments.

9. **Address Gemini feedback**: Run `/address-gemini-feedback` to enter the feedback resolution loop. This will:
   - Fetch unresolved review comments
   - Make necessary code changes
   - Commit and push fixes
   - Reply to addressed comments
   - Repeat until all feedback is resolved

10. **Enter merge queue**: Run `/enter-merge-queue` to automate the merge process. This will continuously update from base, fix CI issues, address reviews, and wait until the PR is actually merged.
