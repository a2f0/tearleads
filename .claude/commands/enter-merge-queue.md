---
description: Guarantee PR merge by cycling until merged. (project)
---

# Enter Merge Queue

This skill guarantees a PR gets merged by continuously updating from base, fixing CI, addressing reviews, and waiting until the PR is actually merged.

## Steps

1. **Verify PR exists**: Run `gh pr view --json number,title,headRefName,baseRefName,url,state` to get PR info. If no PR exists, abort with a message. Store the `baseRefName` for use in subsequent steps.

2. **Check current branch**: Ensure you're on the PR's head branch, not `main`.

3. **Main loop** - Repeat until PR is merged:

   ### 3a. Check PR state

   ```bash
   gh pr view --json state,mergeStateStatus,mergeable
   ```

   - If `state` is `MERGED`: Exit loop and proceed to step 4
   - If `mergeStateStatus` is `BEHIND`: Update from base (step 3b)
   - If `mergeStateStatus` is `BLOCKED` or `UNKNOWN`: Check CI and reviews (step 3c)
   - If `mergeStateStatus` is `CLEAN`: Ensure auto-merge is enabled and wait (step 3f)

   ### 3b. Update from base branch

   ```bash
   git fetch origin <baseRefName>
   git merge origin/<baseRefName> --no-edit
   ```

   - If merge conflicts occur, list them and stop. Do NOT auto-resolve without user input.
   - If successful, push and continue to step 3c.

   ### 3c. Wait for CI

   ```bash
   git push
   git rev-parse HEAD
   gh run list --commit <commit-sha> --limit 1 --json status,conclusion,databaseId
   ```

   - If CI is **in_progress** or **queued**: Wait 30 seconds and check again
   - If CI **passes**: Continue to step 3d
   - If CI **fails**:
     1. Download logs: `gh run view <run-id> --log-failed`
     2. Analyze the failure and fix the issue
     3. Run `/commit-and-push` to push the fix
     4. Return to monitoring CI status

   ### 3d. Request Gemini review (first iteration only)

   On the first pass through the loop, request a review:

   ```bash
   gh pr edit <pr-number> --add-reviewer gemini-code-assist
   ```

   Poll for Gemini's review:

   ```bash
   gh pr view <pr-number> --json reviews
   ```

   Check every 30 seconds until a review from `gemini-code-assist` is found (timeout: 5 minutes).

   ### 3e. Address Gemini feedback

   Run `/address-gemini-feedback` to handle any unresolved comments, then `/follow-up-with-gemini` to:
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

   - If Gemini requests further changes, repeat step 3e

   ### 3f. Enable auto-merge and wait

   ```bash
   gh pr merge --auto --squash
   ```

   Then poll for merge completion:

   ```bash
   gh pr view --json state,mergeStateStatus
   ```

   - If `state` is `MERGED`: Exit loop
   - If `mergeStateStatus` is `BEHIND`: Go back to step 3b
   - Otherwise: Wait 30 seconds and check again

4. **Reset workspace**: Once the PR is merged, run:

   ```bash
   ./scripts/agents/readyVscode.sh
   ```

   This sets the VS Code window title to "ready" and switches back to main with the latest changes.

5. **Report success**: Confirm the PR was merged and show the URL.

## Notes

- This skill loops until the PR is **actually merged**, not just until auto-merge is enabled
- If multiple PRs are in the queue, this PR may need to update from main multiple times as others merge
- Common fixable issues: lint errors, type errors, test failures, code style suggestions
- Non-fixable issues: merge conflicts, infrastructure failures, architectural disagreements
- If stuck in a loop (same fix attempted twice), ask the user for help
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
