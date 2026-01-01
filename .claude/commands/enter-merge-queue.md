---
description: Guarantee PR merge by cycling until merged
---

# Enter Merge Queue

This skill guarantees a PR gets merged by continuously updating from base, fixing CI, addressing reviews, and waiting until the PR is actually merged.

## Steps

1. **Verify PR exists**: Run `gh pr view --json number,title,headRefName,baseRefName,url,state` to get PR info. If no PR exists, abort with a message. Store the `baseRefName` for use in subsequent steps.

2. **Check current branch**: Ensure you're on the PR's head branch, not `main`.

3. **Mark as queued**: Set the VS Code title and tmux window name to show queued status, and move the tmux window to the front of the list:

   ```bash
   ./scripts/agents/setQueued.sh "(queued) #<pr-number> - <branch>"
   ```

4. **Main loop** - Repeat until PR is merged:

   ### 4a. Check PR state

   ```bash
   gh pr view --json state,mergeStateStatus,mergeable
   ```

   - If `state` is `MERGED`: Exit loop and proceed to step 5
   - If `mergeStateStatus` is `BEHIND`: Update from base (step 4b)
   - If `mergeStateStatus` is `BLOCKED` or `UNKNOWN`: Address Gemini feedback (step 4c/4d), then wait for CI (step 4e)
   - If `mergeStateStatus` is `CLEAN`: Ensure auto-merge is enabled and wait (step 4f)

   ### 4b. Update from base branch

   ```bash
   git fetch origin <baseRefName>
   git merge origin/<baseRefName> --no-edit
   ```

   - If merge conflicts occur, list them, clear the queued status with `./scripts/agents/clearQueued.sh`, and stop. Do NOT auto-resolve without user input.
   - If successful, push and continue to step 4c.

   ### 4c. Wait for Gemini review (first iteration only)

   Gemini Code Assist is a GitHub App that automatically reviews PRs - do NOT use `gh pr edit --add-reviewer` as it doesn't work with GitHub App bots.

   On the first pass through the loop, poll for Gemini's review:

   ```bash
   git push
   gh pr view <pr-number> --json reviews
   ```

   Check every 30 seconds until a review from `gemini-code-assist` is found (timeout: 5 minutes).

   ### 4d. Address Gemini feedback

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

   - If Gemini requests further changes, repeat step 4d

   ### 4e. Wait for CI

   ```bash
   git rev-parse HEAD
   gh run list --commit <commit-sha> --limit 1 --json status,conclusion,databaseId
   ```

   - If CI is **in_progress** or **queued**: Wait 30 seconds and check again
   - If CI **passes**: Continue to step 4f
   - If CI is **cancelled**: Rerun CI using the CLI (do NOT push empty commits):

     ```bash
     gh run rerun <run-id>
     ```

   - If CI **fails**:
     1. Download logs: `gh run view <run-id> --log-failed`
     2. Analyze the failure and fix the issue
     3. Run `/commit-and-push` to push the fix
     4. Return to monitoring CI status

   ### 4f. Enable auto-merge and wait

   ```bash
   gh pr merge --auto --squash
   ```

   Then poll for merge completion:

   ```bash
   gh pr view --json state,mergeStateStatus
   ```

   - If `state` is `MERGED`: Exit loop
   - If `mergeStateStatus` is `BEHIND`: Go back to step 4b
   - Otherwise: Wait 30 seconds and check again

5. **Reset workspace**: Once the PR is merged, run:

   ```bash
   ./scripts/agents/reset.sh
   ```

   This sets the VS Code window title to "ready" and switches back to main with the latest changes.

6. **Report success**: Confirm the PR was merged and provide a summary:
   - Show the PR URL
   - Output a brief description of what was merged (1-3 sentences summarizing the changes based on the PR title and commits)

## Notes

- This skill loops until the PR is **actually merged**, not just until auto-merge is enabled
- If multiple PRs are in the queue, this PR may need to update from main multiple times as others merge
- Common fixable issues: lint errors, type errors, test failures, code style suggestions
- Non-fixable issues: merge conflicts, infrastructure failures, architectural disagreements
- If stuck in a loop (same fix attempted twice), ask the user for help
- **Always clear queued status when exiting early**: If you exit the merge queue before the PR is merged (conflicts, user intervention needed, etc.), run `./scripts/agents/clearQueued.sh` to remove the "(queued)" prefix from both VS Code and tmux, and move the tmux window to the back
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

When committing fixes during the merge queue process:

### Conventional Commit Format

- Subject line: `<type>(<scope>): <description>` (max 50 chars)
- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`, `build`
- Scope: prefer feature-based (`pwa`, `auth`, `settings`) over package-based when possible
- Description should be imperative mood ("add" not "added")
- Body can contain detailed explanation (wrap at 72 chars)

### GPG Signing

The commit MUST be signed. Use a 5-second timeout. For multi-line messages, pipe the content to `git commit`:

```bash
printf "subject\n\nbody" | timeout 5 git commit -S -F -
```

### DO NOT

- Add `Co-Authored-By` headers
- Add emoji or "Generated with Claude Code" footers
- Use `--no-gpg-sign` or skip signing
