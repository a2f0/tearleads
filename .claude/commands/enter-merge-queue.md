---
description: Guarantee PR merge by cycling until merged
---

# Enter Merge Queue

This skill guarantees a PR gets merged by continuously updating from base, fixing CI, addressing reviews, and waiting until the PR is actually merged.

## State Tracking

Track the following state during execution:

- `has_bumped_version`: Boolean, starts `false`. Set to `true` after version bump is applied. This ensures we only bump once per PR, even if we loop through multiple CI fixes or rebases.
- `has_waited_for_gemini`: Boolean, starts `false`. Set to `true` after first Gemini review wait. Prevents redundant waits on subsequent loop iterations.
- `gemini_can_review`: Boolean, starts `true`. Set to `false` if PR contains only non-code files. Allows skipping Gemini wait entirely.

## Polling with Jitter

All polling intervals use jitter to prevent thundering herd when multiple agents run concurrently. Apply ±20% randomization:

```text
actual_wait = base_wait × (0.8 + random() × 0.4)
```

For example, a 30-second base wait becomes 24-36 seconds. A 2-minute wait becomes 96-144 seconds.

## Steps

1. **Verify PR exists and check file types**: Run `gh pr view --json number,title,headRefName,baseRefName,url,state,labels,files` to get PR info. If no PR exists, abort with a message. Store the `baseRefName` for use in subsequent steps. Also check if this PR has the `high-priority` label.

   **Early Gemini skip detection**: Check the file extensions in the PR. If ALL files are non-code types, set `gemini_can_review = false`:
   - Config files: `.json`, `.yaml`, `.yml`, `.toml`, `.ini`, `.env*`
   - Docs: `.md`, `.txt`, `.rst`
   - Assets: `.png`, `.jpg`, `.svg`, `.ico`, `.gif`
   - Build/CI: `Dockerfile`, `.dockerignore`, `.gitignore`

   This avoids waiting 5 minutes for Gemini to respond with "unsupported file types".

2. **Check current branch**: Ensure you're on the PR's head branch, not `main`.

3. **Mark as queued**: Set the VS Code title and tmux window name to show queued status, and move the tmux window to the front of the list:

   ```bash
   setQueued.sh "(queued) #<pr-number> - <branch>"
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
   - If `mergeStateStatus` is `BEHIND`: Update from base and bump version (step 4c)
   - If `mergeStateStatus` is `BLOCKED` or `UNKNOWN`: Address Gemini feedback (step 4d/4e), then wait for CI (step 4f)
   - If `mergeStateStatus` is `CLEAN`: Enable auto-merge (step 4g)

   ### 4c. Update from base branch (rebase) and bump version

   Use rebase to keep the branch history clean (no merge commits for updates):

   ```bash
   git fetch origin <baseRefName>
   git rebase origin/<baseRefName>
   ```

   - If rebase conflicts occur:
     1. Run `git rebase --abort` to restore the branch
     2. List the conflicting files
     3. Clear the queued status with `clearQueued.sh`
     4. Stop and ask the user for help. Do NOT auto-resolve conflicts.

   **Bump version immediately after successful rebase** (if `has_bumped_version` is `false`):

   1. Run `bumpVersion.sh` and capture its output
   2. Stage version files: `packages/client/android/app/build.gradle`, `packages/client/ios/App/App.xcodeproj/project.pbxproj`, `packages/api/package.json`, `packages/client/package.json`
   3. Amend the last commit with version bump info in the body (GPG signed)
   4. Set `has_bumped_version = true`

   This saves a full CI cycle by combining rebase + version bump into one push.

   Force push (required after rebase):

   ```bash
   git push --force-with-lease
   ```

   Continue to step 4d.

   ### 4d. Wait for Gemini review (conditional)

   **Skip entirely if**:
   - `gemini_can_review` is `false` (detected in step 1), OR
   - `has_waited_for_gemini` is `true` (already waited on a previous iteration)

   Gemini Code Assist is a GitHub App that automatically reviews PRs - do NOT use `gh pr edit --add-reviewer` as it doesn't work with GitHub App bots.

   Poll for Gemini's review:

   ```bash
   gh pr view <pr-number> --json reviews
   ```

   Check every 30 seconds (with jitter) until a review from `gemini-code-assist` is found (timeout: 5 minutes). Set `has_waited_for_gemini = true` after first successful wait.

   #### Unsupported file types response

   If Gemini's review contains:
   > "Gemini is unable to generate a review for this pull request due to the file types involved not being currently supported."

   Set `gemini_can_review = false` and proceed directly to step 4f (wait for CI).

   ### 4e. Address Gemini feedback

   **Important**: All conversation threads must be resolved before the PR can merge.

   **CRITICAL - Avoid Pending Reviews**: When replying to Gemini comments, use the REST API (`gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_database_id}/replies`), NOT `gh pr review`. The `gh pr review` command creates pending/draft reviews that remain invisible until submitted - Gemini will never see them.

   Run `/address-gemini-feedback` to handle any unresolved comments, then `/follow-up-with-gemini` to:

   - Notify Gemini that feedback has been addressed
   - Immediately check for any existing Gemini confirmations before waiting; resolve threads right away if confirmations are already present
   - If no confirmations yet, wait for Gemini's response (polling every 30 seconds, up to 5 minutes)
   - When Gemini confirms a fix is satisfactory, resolve the thread (see "Resolving Conversation Threads" below)
   - If Gemini requests further changes, repeat step 4e
   - If the wait times out with unresolved threads, return to step 4b (don't proceed to CI) and try again on the next loop

   ### 4f. Wait for CI (with adaptive polling and branch freshness checks)

   **Important**: Check if branch is behind BEFORE waiting for CI, and periodically during CI. This prevents wasting time on CI runs that will be obsolete.

   ```bash
   git rev-parse HEAD
   gh run list --commit <commit-sha> --limit 1 --json status,conclusion,databaseId
   ```

   **Adaptive polling intervals** (with jitter):
   - First 5 minutes: Poll every 1 minute (CI might fail fast on lint/type errors)
   - 5-15 minutes: Poll every 2 minutes
   - After 15 minutes: Poll every 3 minutes

   **While CI is running**:
   - At each poll, also check if branch is behind: `gh pr view --json mergeStateStatus`
   - If `mergeStateStatus` is `BEHIND`: **Immediately** go back to step 4c (don't wait for CI to finish)
   - This avoids wasting 15-20 minutes on a CI run that will need to be rerun anyway

   **When CI completes**:
   - If CI **passes**: Continue to step 4g (enable auto-merge)
   - If CI is **cancelled**: Rerun CI using the CLI (do NOT push empty commits):

     ```bash
     gh run rerun <run-id>
     ```

   - If CI **fails**:
     1. Run `/fix-tests` to diagnose and fix the failure
     2. Return to monitoring CI status

   ### 4g. Enable auto-merge and wait

   **Version bump note**: If `has_bumped_version` is still `false` at this point (a rare edge case, e.g., if the PR started `CLEAN`), perform the version bump now. Run the bump script, stage the version files, amend the last commit, and **force push** the changes. Then, return to step 4f to wait for the new CI run.

   Enable auto-merge:

   ```bash
   gh pr merge --auto --merge
   ```

   Then poll for merge completion (30 seconds with jitter):

   ```bash
   gh pr view --json state,mergeStateStatus
   ```

   - If `state` is `MERGED`: Exit loop
   - If `mergeStateStatus` is `BEHIND`: Go back to step 4c
   - Otherwise: Wait and check again

5. **Refresh workspace**: Once the PR is merged, run:

   ```bash
   refresh.sh
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

## Token Efficiency

Minimize context consumption during long merge queue sessions:

- **Suppress stdout on git operations**: Pre-push hooks run linting, builds, and tests that produce verbose stdout. Redirect stdout to `/dev/null` while preserving stderr for errors:

  ```bash
  git push --force-with-lease >/dev/null
  git push >/dev/null
  ```

- **Only stderr matters**: On success, the exit code is sufficient. On failure, errors appear on stderr which is preserved by the redirect.

- **Cache PR metadata**: Store `number`, `baseRefName`, `headRefName`, `url` from step 1. Don't re-fetch immutable data.
- **Minimal status checks**: Use `--json` with only needed fields (e.g., `state,mergeStateStatus` not full PR details).
- **Avoid verbose CI logs**: When checking CI status, don't fetch full logs unless there's a failure to diagnose.
- **Batch state updates**: Combine related status messages rather than outputting each check individually.
- **Skip redundant waits**: Use state flags (`has_waited_for_gemini`, `gemini_can_review`) to avoid repeating completed steps.

## Notes

- Loops until PR is **actually merged**, not just auto-merge enabled
- Non-high-priority PRs yield to high-priority ones (check every 2 min with jitter)
- Prioritize staying up-to-date over waiting for CI in congested queues
- Fixable: lint/type errors, test failures. Non-fixable: merge conflicts, infra failures
- If stuck (same fix attempted twice), ask user for help
- On early exit, run `clearQueued.sh`
- Gemini confirmation detection: positive phrases ("looks good", "lgtm", etc.) WITHOUT negative qualifiers ("but", "however", "still")
- Only resolve threads after explicit Gemini confirmation

## Keeping PR Description Updated

As you iterate, update the PR body with `gh pr edit --body`. Preserve any `Closes #<issue>` lines and the `Agent:` line at the bottom. Add bullets for significant changes (CI fixes, Gemini feedback addressed).

## Commit Rules

Follow commit guidelines in `CLAUDE.md`: conventional commits, GPG signed with 5s timeout, no co-author lines or footers.
