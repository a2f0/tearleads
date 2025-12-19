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

4. **GPG signing**: The commit MUST be signed. Use a 5-second timeout:
   ```
   timeout 5 git commit -m "message"
   ```
   If the commit times out (exit code 124), output an error telling the user to unlock their GPG keychain and DO NOT retry or commit unsigned.

5. **Push**: After successful commit, push to the current branch's remote.
