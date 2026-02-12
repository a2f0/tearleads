---
description: Mark a PR as high-priority to skip merge queue yielding
---

# Mark High Priority

Add the `high-priority` label to the current PR so that other PRs in the merge queue will yield to it.

## Steps

1. **Get PR number**: Run `gh pr view --json number` to get the PR number (infers from current branch).

2. **Add the label**: Use the agent tool to add the `high-priority` label:

   ```bash
   ./scripts/agents/tooling/agentTool.sh addLabel --type pr --number <pr-number> --label "high-priority"
   ```

   The script automatically checks if the label is already present and verifies success.

3. **Report**: Confirm the label was added.

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
- To remove the label later: `gh pr edit <pr-number> --remove-label "high-priority" -R "$REPO"`
