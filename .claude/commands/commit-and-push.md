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

3. **Commit format**: Follow `CLAUDE.md` guidelines (conventional commits, GPG signed with 5s timeout, no co-author/footers, no binary files). Don't bump versions - that happens in `/enter-merge-queue`.

4. **Push**: After successful commit, push to the current branch's remote.

5. **Open PR**: If no PR exists for this branch, create one with `gh pr create`. Include `Closes #<issue-number>` in the body if tracking an issue. After creating, run `./scripts/agents/setVscodeTitle.sh`.

6. **Wait for Gemini**: Wait 60 seconds for Gemini Code Assist to review.

7. **Address feedback**: Run `/address-gemini-feedback` to handle unresolved comments.

8. **Merge**: Run `/enter-merge-queue` to automate merging (updates from base, fixes CI, bumps versions, waits for merge).
