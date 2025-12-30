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

   Run `/address-gemini-feedback` to handle any unresolved comments, then `/follow-up-with-gemini` to reply.

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

## Commit Rules

When committing fixes, follow the same rules as `/commit-and-push`:

- **DO NOT** add `Co-Authored-By` headers
- **DO NOT** add emoji or "Generated with Claude Code" footers
- **DO NOT** use `--no-gpg-sign` or skip signing
- Use conventional commit format: `<type>(<scope>): <description>`
