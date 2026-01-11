---
description: Mark a PR as needing QA after merge
---

# Mark Needs QA

Add the `needs-qa` label to the current PR so that the merge queue will create/preserve an issue and mark it for QA after the PR merges.

## Steps

1. **Get PR info**: Run `gh pr view --json number,labels,body` to get the PR number, current labels, and body.

2. **Check if already marked**: If the PR already has the `needs-qa` label, inform the user and exit.

3. **Check for auto-close language**: Scan the PR body for `Closes #`, `Fixes #`, `Resolves #` (case-insensitive). If found:

   - Warn the user that this language will auto-close the issue
   - Remove the auto-close language from the PR body using `gh pr edit --body`
   - Inform the user what was removed

4. **Add the label**: Use the GitHub CLI to add the `needs-qa` label:

   ```bash
   gh pr edit <pr-number> --add-label "needs-qa"
   ```

5. **Confirm**: Verify the label was added and report success:

   ```bash
   gh pr view <pr-number> --json labels
   ```

## What This Does

When a PR has the `needs-qa` label:

- The merge queue will **create an issue** for the PR if one doesn't exist
- The PR description will have any auto-close language removed (to prevent the issue from closing on merge)
- After the PR merges, the associated issue will be labeled with **"Needs QA"**
- If the associated issue is already closed, it will be **reopened** for QA verification
- This ensures QA can track and verify the changes before the issue is closed

## When to Use

- Features that need manual QA verification before release
- Changes that affect user-facing behavior
- Bug fixes that should be verified in a staging/production environment
- Any change where automated tests aren't sufficient to verify correctness

## Notes

- The `needs-qa` label must exist in the repository (create it if it doesn't)
- An issue will be created automatically if one doesn't exist for the PR
- Closed issues will be reopened after merge for QA verification
- The issue will remain open after merge, labeled "Needs QA"
- QA should close the issue after verifying the changes
- To remove the label: `gh pr edit <pr-number> --remove-label "needs-qa"`
