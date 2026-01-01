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

   ### 4b. Update from base branch (rebase)

   Use rebase to keep the branch history clean (no merge commits for updates):

   ```bash
   git fetch origin <baseRefName>
   git rebase origin/<baseRefName>
   ```

   - If rebase conflicts occur:
     1. Run `git rebase --abort` to restore the branch
     2. List the conflicting files
     3. Clear the queued status with `./scripts/agents/clearQueued.sh`
     4. Stop and ask the user for help. Do NOT auto-resolve conflicts.
   - If successful, force push (required after rebase) and continue to step 4c:

     ```bash
     git push --force-with-lease
     ```

   ### 4c. Wait for Gemini review (first iteration only)

   Gemini Code Assist is a GitHub App that automatically reviews PRs - do NOT use `gh pr edit --add-reviewer` as it doesn't work with GitHub App bots.

   On the first pass through the loop, poll for Gemini's review:

   ```bash
   gh pr view <pr-number> --json reviews
   ```

   Check every 30 seconds until a review from `gemini-code-assist` is found (timeout: 5 minutes).

   ### 4d. Address Gemini feedback

   **Important**: All conversation threads must be resolved before the PR can merge.

   Run `/address-gemini-feedback` to handle any unresolved comments, then `/follow-up-with-gemini` to:

   - Notify Gemini that feedback has been addressed
   - Wait for Gemini's response (polling every 30 seconds, up to 5 minutes)
   - When Gemini confirms a fix is satisfactory, resolve the thread (see "Resolving Conversation Threads" below)
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
     1. Run `/fix-tests` to diagnose and fix the failure
     2. Return to monitoring CI status

   ### 4f. Enable auto-merge and wait

   ```bash
   gh pr merge --auto --merge
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

7. **Compact the conversation**: Run `/compact` to summarize the conversation and free up context for new tasks. This is important because merge queue sessions can consume significant context with CI logs, Gemini feedback, and iterative fixes.

## Opening GitHub Issues

Create GitHub issues to track problems discovered during the merge queue process that shouldn't block the current PR:

### When to Open Issues

- **Flaky tests**: Tests that fail intermittently but pass on retry
- **Infrastructure issues**: CI runner timeouts, resource exhaustion, network failures
- **Technical debt**: Code quality issues noticed but out of scope for current PR
- **Future improvements**: Ideas or optimizations that should be tracked
- **Recurring failures**: Same test/job failing across multiple PRs

### How to Create Issues

```bash
gh issue create --title "flaky: iOS Maestro test intermittent failure" --body "$(cat <<'EOF'
## Description
The iOS Maestro test `login_flow.yaml` failed during PR #273 merge queue but passed on retry.

## Evidence
- CI run: https://github.com/a2f0/rapid/actions/runs/12345
- Error: `Timeout waiting for element`

## Suggested Fix
Increase timeout or add retry logic for slow simulator startup.
EOF
)"
```

### Issue Labels

Use appropriate labels when creating issues:

- `flaky-test` - Intermittent test failures
- `ci` - CI/infrastructure related
- `bug` - Actual bugs discovered
- `enhancement` - Improvements to track

### Important

- Do NOT let issue creation block the merge queue
- Create the issue, note its number, and continue with the merge
- When resolving a conversation with an issue, link the issue in the thread reply (NOT in PR body)

## Resolving Conversation Threads

**All conversation threads must be resolved before the PR can merge.** When resolving a thread, provide context in the thread itself (not the PR body).

### Before Resolving a Thread

Reply to the thread with:

1. **The commit(s) that fixed the issue** - Link to the specific commit(s) that addressed the feedback
2. **If an issue was opened** - Link the issue that will track the work

### Reply Format

```bash
# Get the commit SHA for the fix
git log --oneline -1

# Reply to the thread with context
gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_id}/replies \
  -f body="Fixed in commit abc1234. @gemini-code-assist Please confirm."
```

If an issue was created instead of a direct fix:

```bash
gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_id}/replies \
  -f body="Tracked in #456 for follow-up. Resolving as out of scope for this PR."
```

### Then Resolve the Thread

```bash
gh api graphql -f query='
  mutation {
    resolveReviewThread(input: {threadId: "<thread_node_id>"}) {
      thread { isResolved }
    }
  }
'
```

### Examples

**Fixed with a commit:**

> Fixed in commit e6aabdb. The error handling now catches the edge case you identified. @gemini-code-assist Please confirm.

**Deferred to an issue:**

> This is a broader architectural concern. Tracked in #789 for follow-up. Resolving as out of scope for this PR.

**Fixed across multiple commits:**

> Addressed in commits abc1234 and def5678. The first commit adds the validation, the second adds tests. @gemini-code-assist Please confirm.

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

Closes #<issue-number>
EOF
)"
```

Guidelines:

- **Always preserve the `Closes #<issue>` line(s)** if the PR was opened to address one or more GitHub issues
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
