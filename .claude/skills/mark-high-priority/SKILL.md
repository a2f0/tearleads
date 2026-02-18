---
name: mark-high-priority
description: Add the high-priority label to a PR so merge-queue automation yields to it. Use when a PR needs to bypass normal queue yielding for urgent fixes or time-sensitive deployments.
---


# Mark High Priority

Add the `high-priority` label to a PR so other merge-queue sessions yield to it.

## Workflow

1. Get PR number:

   ```bash
   gh pr view --json number --jq '.number'
   ```

2. Add the label using the agent tool:

   ```bash
   ./scripts/agents/tooling/agentTool.ts addLabel --type pr --number <pr-number> --label "high-priority"
   ```

   The script automatically checks if the label is already present and verifies success.

3. Report that the label was added.

## Notes

- The `high-priority` label must exist in the repository (create it if it doesn't).
- Use sparingly to keep the merge queue fair.
- To remove later: `gh pr edit <pr-number> --remove-label "high-priority" -R "$REPO"`.
