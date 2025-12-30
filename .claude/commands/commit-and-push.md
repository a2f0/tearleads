---
description: Commit staged changes and push to remote using conventional commits. (project)
---

# Commit and Push

Commit and push the current changes following these rules:

1. **Check branch**: If on `main`, create a new branch with an appropriate name based on the changes. After creating or switching branches, update the VS Code title:

   ```bash
   ./scripts/agents/updateVscodeTitle.sh
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

5. **GPG signing**: The commit MUST be signed. Use a 5-second timeout. For multi-line messages, pipe the content to `git commit`:

   ```bash
   printf "subject\n\nbody" | timeout 5 git commit -F -
   ```

6. **Push**: After successful commit, push to the current branch's remote.

7. **Open PR**: If a PR doesn't already exist for this branch, create one using `gh pr create`. Skip if already on `main` or PR exists. After creating a PR, update the VS Code title to show the PR number:

   ```bash
   ./scripts/agents/updateVscodeTitle.sh
   ```

8. **Wait for Gemini feedback**: After the push completes (and PR is created/updated), wait 60 seconds for Gemini Code Assist to post its review comments.

9. **Address Gemini feedback**: Run `/address-gemini-feedback` to enter the feedback resolution loop. This will:
   - Fetch unresolved review comments
   - Make necessary code changes
   - Commit and push fixes
   - Reply to addressed comments
   - Repeat until all feedback is resolved
