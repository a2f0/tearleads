---
description: Update branch, fix tests, get Gemini review, and enable auto-merge. (project)
---

# Enter Merge Queue

This skill prepares a PR to be merged by updating it from the base branch, ensuring CI passes, getting Gemini review feedback, and enabling auto-merge.

## Steps

1. **Verify PR exists**: Run `gh pr view --json number,title,headRefName,baseRefName,url` to get PR info. If no PR exists, abort with a message. Store the `baseRefName` for use in subsequent steps.

2. **Check current branch**: Ensure you're on the PR's head branch, not `main`.

3. **Fetch and merge base branch** (use the `baseRefName` from step 1):

   ```bash
   git fetch origin <baseRefName>
   git merge origin/<baseRefName> --no-edit
   ```

   If already up-to-date, skip to step 5.

4. **Handle merge conflicts**: If there are conflicts, list them and stop. Do NOT attempt to auto-resolve conflicts without user input.

5. **Push updated branch and get commit SHA**:

   ```bash
   git push
   ```

   After pushing, get the current commit SHA for tracking the CI run:

   ```bash
   git rev-parse HEAD
   ```

6. **Wait for CI and fix failures**: Monitor CI status for the specific commit in a loop:

   ```bash
   gh run list --commit <commit-sha> --limit 1 --json status,conclusion,databaseId
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

   Poll for Gemini's review instead of using a fixed wait time:

   ```bash
   gh pr view <pr-number> --json reviews
   ```

   Check every 30 seconds for a new review from `gemini-code-assist` until one is found or a reasonable timeout (5 minutes) is reached.

8. **Address Gemini feedback**: Run `/address-gemini-feedback` to:
   - Find unresolved Gemini review comments
   - Make the necessary code changes
   - Commit and push fixes
   - Reply to Gemini's comments

9. **Follow up with Gemini and resolve threads**: Run `/follow-up-with-gemini` to:
   - Notify Gemini that feedback has been addressed
   - Wait for Gemini's response (polling every 30 seconds, up to 5 minutes)
   - When Gemini confirms a fix is satisfactory, resolve the review thread using the GraphQL API:

     ```bash
     gh api graphql -f query='
       mutation {
         resolveReviewThread(input: {threadId: "<thread_node_id>"}) {
           thread { isResolved }
         }
       }
     '
     ```

   - If Gemini requests further changes, return to step 8

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
- When Gemini confirms a fix, resolve the thread via GraphQL. To detect confirmation:
  1. Look for positive phrases: "looks good", "resolved", "satisfied", "fixed", "approved", "thank you", "lgtm"
  2. Ensure the response does NOT contain negative qualifiers: "but", "however", "still", "issue", "problem", "not yet", "almost"
  3. Only resolve if both conditions are met (positive phrase present AND no negative qualifiers)
- Only resolve threads after explicit confirmation from Gemini - do not auto-resolve based on your own assessment

## Keeping PR Description Updated

As you iterate through fixes, keep the PR description accurate:

```bash
gh pr edit <pr-number> --body "$(cat <<'EOF'
## Summary
- Original feature/fix description
- Additional: fixed CI lint errors
- Additional: addressed Gemini feedback on error handling
EOF
)"
```

Guidelines:

- Add bullet points for significant changes made during the merge queue process
- Document CI fixes, Gemini feedback addressed, and any scope changes
- Keep it concise - the commit history has the details

## Commit Rules

When committing fixes, follow the same rules as `/commit-and-push`:

- **DO NOT** add `Co-Authored-By` headers
- **DO NOT** add emoji or "Generated with Claude Code" footers
- **DO NOT** use `--no-gpg-sign` or skip signing
- Use conventional commit format: `<type>(<scope>): <description>`
