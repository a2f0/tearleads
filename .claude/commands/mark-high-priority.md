---
description: Mark a PR as high-priority to skip merge queue yielding
---

# Mark High Priority

**First**: Determine the repository for all `gh` commands:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
```

Use `-R "$REPO"` with all `gh` commands in this skill.

Add the `high-priority` label to the current PR so that other PRs in the merge queue will yield to it.

## Steps

1. **Get PR info**: Run `gh pr view --json number,labels` to get the PR number and current labels.

2. **Check if already high-priority**: If the PR already has the `high-priority` label, inform the user and exit.

3. **Add the label**: Use the GitHub CLI to add the `high-priority` label:

   ```bash
   gh pr edit <pr-number> --add-label "high-priority"
   ```

4. **Confirm**: Verify the label was added and report success:

   ```bash
   gh pr view <pr-number> --json labels
   ```

## What This Does

When a PR has the `high-priority` label:

- Other PRs in the merge queue will **yield** to this PR
- Non-high-priority PRs will pause and wait (checking every 2 minutes) while this PR has `mergeStateStatus` of `CLEAN` or `BLOCKED`
- This ensures urgent fixes get through the queue faster

## When to Use

- Hotfixes that need to ship immediately
- Critical bug fixes blocking other work
- Time-sensitive deployments

## Notes

- The `high-priority` label must exist in the repository (create it if it doesn't)
- Use sparingly - overuse defeats the purpose of prioritization
- To remove the label later: `gh pr edit <pr-number> --remove-label "high-priority"`
