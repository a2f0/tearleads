---
description: Commit staged changes and push to remote using conventional commits.
---

# Commit and Push

Commit and push the current changes following these rules:

1. **Analyze changes**: Run `git status` and `git diff --staged` to understand what's being committed.

2. **Conventional commit format**:
   - Subject line: `<type>(<scope>): <description>` (max 50 chars)
   - Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`, `build`
   - Scope: prefer feature-based (`pwa`, `auth`, `settings`) over package-based when possible
   - Description should be imperative mood ("add" not "added")
   - Body can contain detailed explanation (wrap at 72 chars)

3. **DO NOT**:
   - Add `Co-Authored-By` headers
   - Add emoji or "Generated with Claude Code" footers
   - Use `--no-gpg-sign` or skip signing

4. **GPG signing**: The commit MUST be signed. Use a 5-second timeout. For multi-line messages, pipe the content to `git commit`:

   ```bash
   printf "subject\n\nbody" | timeout 5 git commit -F -
   ```

5. **Push**: After successful commit, push to the current branch's remote.

6. **Open PR**: If NOT on the `main` branch, open a pull request using `gh pr create`. Skip this step if already on `main`.
