---
description: Update branch, fix tests, get Gemini review, and enable auto-merge. (project)
---

# Enter Merge Queue

This skill prepares a PR to be merged by updating it from the base branch, ensuring CI passes, getting Gemini review feedback, and enabling auto-merge.

## Steps

1. **Verify PR exists**: Run `gh pr view --json number,title,headRefName,baseRefName,url | cat` to get PR info. If no PR exists, abort with a message.

2. **Check current branch**: Ensure you're on the PR's head branch, not `main`.

3. **Fetch and merge base branch**:

   ```bash
   git fetch origin main
   git merge origin/main --no-edit
   ```

   If already up-to-date, skip to step 5.

4. **Handle merge conflicts**: If there are conflicts, list them and stop. Do NOT attempt to auto-resolve conflicts without user input.

5. **Push updated branch**:

   ```bash
   git push
   ```

6. **Wait for CI and fix failures**: Monitor CI status in a loop:

   ```bash
   gh run list --branch <branch> --limit 1 --json status,conclusion,databaseId
   ```

   - If CI is **in_progress** or **queued**: Wait 30 seconds and check again
   - If CI **passes**: Proceed to next step
   - If CI **fails**:
     1. Download logs: `gh run view <run-id> --log-failed`
     2. Analyze the failure and fix the issue
     3. Run `/commit-and-push` to push the fix
     4. Return to monitoring CI status

7. **Request Gemini review**: Request a review from gemini-code-assist:

   ```bash
   gh pr edit <pr-number> --add-reviewer gemini-code-assist
   ```

   Wait 60 seconds for Gemini to post its review.

8. **Address Gemini feedback**: Run `/address-gemini-feedback` to:
   - Find unresolved Gemini review comments
   - Make the necessary code changes
   - Commit and push fixes
   - Reply to Gemini's comments

9. **Follow up with Gemini**: Run `/follow-up-with-gemini` to notify Gemini that feedback has been addressed.

10. **Wait for CI again**: After addressing feedback, wait for CI to pass (repeat step 6).

11. **Enable auto-merge**: Once CI passes and Gemini feedback is addressed, enable auto-merge:

    ```bash
    gh pr merge --auto --squash
    ```

12. **Report status**: Show the PR URL and confirm auto-merge is enabled.

## Notes

- This skill will loop until CI passes and Gemini feedback is resolved
- Common fixable issues: lint errors, type errors, test failures, code style suggestions
- Non-fixable issues: merge conflicts, infrastructure failures, architectural disagreements
- If stuck in a loop (same fix attempted twice), ask the user for help
- If Gemini posts new feedback after fixes, repeat steps 8-10

## Commit Rules

When committing fixes, follow the same rules as `/commit-and-push`:

- **DO NOT** add `Co-Authored-By` headers
- **DO NOT** add emoji or "Generated with Claude Code" footers
- **DO NOT** use `--no-gpg-sign` or skip signing
- Use conventional commit format: `<type>(<scope>): <description>`
