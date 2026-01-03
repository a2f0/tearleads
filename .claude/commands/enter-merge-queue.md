---
description: Guarantee PR merge by cycling until merged
---

# Enter Merge Queue

This skill guarantees a PR gets merged by continuously updating from base, fixing CI, addressing reviews, and waiting until the PR is actually merged.

## State Tracking

Track the following state during execution:

- `has_bumped_version`: Boolean, starts `false`. Set to `true` after version bump is applied. This ensures we only bump once per PR, even if we loop through multiple CI fixes or rebases.

## Steps

1. **Verify PR exists**: Run `gh pr view --json number,title,headRefName,baseRefName,url,state,labels` to get PR info. If no PR exists, abort with a message. Store the `baseRefName` for use in subsequent steps. Also check if this PR has the `high-priority` label.

2. **Check current branch**: Ensure you're on the PR's head branch, not `main`.

3. **Mark as queued**: Set the VS Code title and tmux window name to show queued status, and move the tmux window to the front of the list:

   ```bash
   ./scripts/agents/setQueued.sh "(queued) #<pr-number> - <branch>"
   ```

4. **Main loop** - Repeat until PR is merged:

   ### 4a. Yield to high-priority PRs

   If the current PR does NOT have the `high-priority` label, check if any other open PRs do:

   ```bash
   gh pr list --label "high-priority" --state open --json number,headRefName,mergeStateStatus
   ```

   - If high-priority PRs exist and any have `mergeStateStatus` of `CLEAN` or `BLOCKED` (meaning they're actively trying to merge):
     1. Log: "Yielding to high-priority PR #X"
     2. Wait 2 minutes before rechecking
     3. Repeat this check until no high-priority PRs are actively merging
   - If no high-priority PRs exist, or they're all `BEHIND` or `DIRTY`, proceed normally
   - If the current PR IS high-priority, skip this check entirely

   ### 4b. Check PR state

   ```bash
   gh pr view --json state,mergeStateStatus,mergeable
   ```

   - If `state` is `MERGED`: Exit loop and proceed to step 5
   - If `mergeStateStatus` is `BEHIND`: Update from base (step 4c)
   - If `mergeStateStatus` is `BLOCKED` or `UNKNOWN`: Address Gemini feedback (step 4d/4e), then wait for CI (step 4f)
   - If `mergeStateStatus` is `CLEAN`: Bump version if needed (step 4g), then enable auto-merge (step 4h)

   ### 4c. Update from base branch (rebase)

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
   - If successful, force push (required after rebase) and continue to step 4d:

     ```bash
     git push --force-with-lease
     ```

   ### 4d. Wait for Gemini review (first iteration only)

   Gemini Code Assist is a GitHub App that automatically reviews PRs - do NOT use `gh pr edit --add-reviewer` as it doesn't work with GitHub App bots.

   On the first pass through the loop, poll for Gemini's review:

   ```bash
   gh pr view <pr-number> --json reviews
   ```

   Check every 30 seconds until a review from `gemini-code-assist` is found (timeout: 5 minutes).

   #### Special case: Unsupported file types

   If Gemini's review contains:
   > "Gemini is unable to generate a review for this pull request due to the file types involved not being currently supported."

   This means Gemini cannot review the PR (e.g., only config files, images, or other non-code changes). Skip step 4d entirely and proceed directly to step 4f (wait for CI).

   ### 4e. Address Gemini feedback

   **Important**: All conversation threads must be resolved before the PR can merge.

   Run `/address-gemini-feedback` to handle any unresolved comments, then `/follow-up-with-gemini` to:

   - Notify Gemini that feedback has been addressed
   - Wait for Gemini's response (polling every 30 seconds, up to 5 minutes)
   - When Gemini confirms a fix is satisfactory, resolve the thread (see "Resolving Conversation Threads" below)
   - If Gemini requests further changes, repeat step 4e

   ### 4f. Wait for CI (with branch freshness checks)

   **Important**: Check if branch is behind BEFORE waiting for CI, and periodically during CI. This prevents wasting time on CI runs that will be obsolete.

   ```bash
   git rev-parse HEAD
   gh run list --commit <commit-sha> --limit 1 --json status,conclusion,databaseId
   ```

   **While CI is running**:
   - Every 2-3 minutes, check if branch is behind: `gh pr view --json mergeStateStatus`
   - If `mergeStateStatus` is `BEHIND`: **Immediately** go back to step 4c (don't wait for CI to finish)
   - This avoids wasting 15-20 minutes on a CI run that will need to be rerun anyway

   **When CI completes**:
   - If CI **passes**: Continue to step 4g (bump version)
   - If CI is **cancelled**: Rerun CI using the CLI (do NOT push empty commits):

     ```bash
     gh run rerun <run-id>
     ```

   - If CI **fails**:
     1. Run `/fix-tests` to diagnose and fix the failure
     2. Return to monitoring CI status

   ### 4g. Bump version (once per PR)

   **Only run if `has_bumped_version` is `false`.**

   1. Run `./scripts/bumpVersion.sh` and capture its output (shows old -> new versions for Android, iOS, API, Client)
   2. Stage version files: `packages/client/android/app/build.gradle`, `packages/client/ios/App/App.xcodeproj/project.pbxproj`, `packages/api/package.json`, `packages/client/package.json`
   3. Amend the last commit with version bump info in the body (GPG signed)
   4. Force push with `--force-with-lease`
   5. Set `has_bumped_version = true`

   After force pushing, CI restarts - return to step 4f.

   ### 4h. Enable auto-merge and wait

   ```bash
   gh pr merge --auto --merge
   ```

   Then poll for merge completion:

   ```bash
   gh pr view --json state,mergeStateStatus
   ```

   - If `state` is `MERGED`: Exit loop
   - If `mergeStateStatus` is `BEHIND`: Go back to step 4c
   - Otherwise: Wait 30 seconds and check again

5. **Refresh workspace**: Once the PR is merged, run:

   ```bash
   ./scripts/agents/refresh.sh
   ```

   This sets the VS Code window title to "ready" and switches back to main with the latest changes.

6. **Report success**: Confirm the PR was merged and provide a summary:
   - Show the PR URL
   - Output a brief description of what was merged (1-3 sentences summarizing the changes based on the PR title and commits)

7. **Compact the conversation**: Run `/compact` to summarize the conversation and free up context for new tasks. This is important because merge queue sessions can consume significant context with CI logs, Gemini feedback, and iterative fixes.

## Opening GitHub Issues

Create issues for problems that shouldn't block the PR (flaky tests, infrastructure issues, tech debt). Use labels: `flaky-test`, `ci`, `bug`, `enhancement`. Don't let issue creation block the merge - create it and continue.

## Resolving Conversation Threads

All threads must be resolved before merge. Use `/follow-up-with-gemini` which handles replying with commit SHAs, waiting for confirmation, and resolving threads via GraphQL.

## Notes

- Loops until PR is **actually merged**, not just auto-merge enabled
- Non-high-priority PRs yield to high-priority ones (check every 2 min)
- Prioritize staying up-to-date over waiting for CI in congested queues
- Fixable: lint/type errors, test failures. Non-fixable: merge conflicts, infra failures
- If stuck (same fix attempted twice), ask user for help
- On early exit, run `./scripts/agents/clearQueued.sh`
- Gemini confirmation detection: positive phrases ("looks good", "lgtm", etc.) WITHOUT negative qualifiers ("but", "however", "still")
- Only resolve threads after explicit Gemini confirmation

## Keeping PR Description Updated

As you iterate, update the PR body with `gh pr edit --body`. Preserve any `Closes #<issue>` lines and add bullets for significant changes (CI fixes, Gemini feedback addressed).

## Commit Rules

Follow commit guidelines in `CLAUDE.md`: conventional commits, GPG signed with 5s timeout, no co-author lines or footers.
