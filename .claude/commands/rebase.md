# Rebase onto Main

Rebase the current branch onto the latest main branch, resolving conflicts by preferring upstream changes.

## Steps

1. **Fetch latest changes**:

   ```bash
   git fetch origin main
   ```

2. **Start rebase with upstream preference**:

   ```bash
   git rebase -X theirs origin/main
   ```

   The `-X theirs` strategy resolves conflicts by preferring the upstream (main) version.

3. **If rebase fails** (conflicts that can't be auto-resolved):
   - Check `git status` to see conflicting files
   - For each conflict, accept the upstream version:

     ```bash
     git checkout --theirs <file>
     git add <file>
     ```

   - Continue the rebase:

     ```bash
     git rebase --continue
     ```

   - Repeat until rebase completes

4. **Force push the rebased branch**:

   ```bash
   git push --force-with-lease
   ```

## Notes

- This skill prefers upstream (main) changes when conflicts occur
- Use this when you want to update your branch and don't mind losing local changes that conflict
- The `--force-with-lease` flag is safer than `--force` as it won't overwrite remote changes you haven't seen
- Always suppress stdout on git push to save tokens: `git push --force-with-lease >/dev/null`
