---
description: Guarantee PR merge by cycling until merged
---

# Enter Merge Queue

**First**: Determine the repository for all `gh` commands:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
```

Use `-R "$REPO"` with all `gh` commands in this skill.

This skill guarantees a PR gets merged by continuously updating from base, fixing CI, addressing reviews, and waiting until the PR is actually merged.

## State Tracking

Track the following state during execution:

- `has_bumped_version`: Boolean, starts `false`. Set to `true` after version bump is applied. This ensures we only bump once per PR, even if we loop through multiple CI fixes or rebases.
- `has_waited_for_gemini`: Boolean, starts `false`. Set to `true` after first Gemini review wait. Prevents redundant waits on subsequent loop iterations.
- `gemini_can_review`: Boolean, starts `true`. Set to `false` if PR contains only non-code files. Allows skipping Gemini wait entirely.
- `needs_qa`: Boolean, starts `false`. Set to `true` if PR has the `needs-qa` label. When true, an issue will be created/preserved and labeled "Needs QA" after merge.
- `associated_issue_number`: Number or null. The issue number associated with this PR (either extracted from PR body or newly created). Only tracked when `needs_qa` is `true`.

## Polling with Jitter

All polling intervals use jitter to prevent thundering herd when multiple agents run concurrently. Apply ±20% randomization:

```text
actual_wait = base_wait × (0.8 + random() × 0.4)
```

For example, a 30-second base wait becomes 24-36 seconds. A 2-minute wait becomes 96-144 seconds.

## Steps

1. **Verify PR exists and check file types**: Run `gh pr view --json number,title,headRefName,baseRefName,url,state,labels,files,body` to get PR info. If no PR exists, abort with a message. Store the `baseRefName` for use in subsequent steps. Also check if this PR has the `high-priority` label or `needs-qa` label.

   **Early Gemini skip detection**: Check the file extensions in the PR. If ALL files are non-code types, set `gemini_can_review = false`:
   - Config files: `.json`, `.yaml`, `.yml`, `.toml`, `.ini`, `.env*`
   - Docs: `.md`, `.txt`, `.rst`
   - Assets: `.png`, `.jpg`, `.svg`, `.ico`, `.gif`
   - Build/CI: `Dockerfile`, `.dockerignore`, `.gitignore`

   This avoids waiting 5 minutes for Gemini to respond with "unsupported file types".

   **Needs QA handling**: If the PR has the `needs-qa` label, set `needs_qa = true` and perform the following:

   1. **Check for auto-close language**: Scan the PR body for patterns like `Closes #`, `Fixes #`, `Resolves #` (case-insensitive). If found:
      - Extract the issue number(s) from the pattern
      - Remove ALL auto-close language from the PR body using `gh pr edit --body`
      - Store the first extracted issue number as `associated_issue_number`
      - **Note**: Only the first issue is tracked for QA. If the PR references multiple issues (e.g., `Fixes #123, Fixes #456`), run `/mark-needs-qa` separately for each issue that needs QA tracking, or manually create QA issues for the others.

   2. **Find or create associated issue**: If no issue number was extracted from the PR body:
      - Search for an existing open issue that references this PR: `gh issue list --search "PR #<number>" --state open --json number --limit 1`
      - If no issue found, create one:

        ```bash
        gh issue create --title "QA: <PR title>" --body "## QA Verification Needed

        This issue tracks QA verification for PR #<number>.

        **PR**: <pr-url>

        ## Changes to Verify
        <brief description from PR title>

        ## QA Checklist
        - [ ] Verified in staging/production
        - [ ] No regressions observed
        "
        ```

      - Store the issue number as `associated_issue_number`

2. **Check current branch**: Ensure you're on the PR's head branch, not `main`.

3. **Mark as queued**: Set the VS Code title and tmux window name to show queued status, and move the tmux window to the front of the list:

   ```bash
   setQueued.sh "(queued) #<pr-number> - <branch>"
   ```

4. **Main loop** - Repeat until PR is merged:

   ### 4a. Yield to high-priority PRs

   If the current PR does NOT have the `high-priority` label, check if any other open PRs do.

   **Step 1**: Get the list of high-priority PR numbers:

   ```bash
   gh pr list --label "high-priority" --state open --search "-is:draft" --json number
   ```

   **Step 2**: For each high-priority PR, get its merge state (required because `mergeStateStatus` is not available in `gh pr list`):

   ```bash
   gh pr view <pr-number> --json mergeStateStatus
   ```

   **Step 3**: Determine whether to yield:

   - **Yield** if any high-priority PR has `mergeStateStatus` of `CLEAN`, `BLOCKED`, `BEHIND`, `UNKNOWN`, `UNSTABLE`, or `HAS_HOOKS`:
     1. Log: "Yielding to high-priority PR #X (status: Y)"
     2. Wait 2 minutes (with jitter) before rechecking
     3. Repeat from Step 1 until no high-priority PRs require yielding
   - **Proceed normally** if:
     - No high-priority PRs exist, OR
     - All high-priority PRs have `mergeStateStatus` of `DIRTY` (conflicts that need manual resolution)
   - **Skip this check entirely** if the current PR has the `high-priority` label

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
   2. Stage version files: `packages/client/android/app/build.gradle`, `packages/client/ios/App/App.xcodeproj/project.pbxproj`, `packages/api/package.json`, `packages/client/package.json`, `packages/chrome-extension/package.json`, `packages/chrome-extension/public/manifest.json`
   3. Expect the Chrome extension version changes from `bumpVersion.sh`. These are valid, intentional diffs for the release bump.
   4. Amend the last commit with version bump info in the body (GPG signed). Do NOT create a separate commit for the bump.
   5. Set `has_bumped_version = true`

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

   **CRITICAL - Avoid Pending Reviews**: When replying to Gemini comments, use the REST API (`gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_database_id}/replies`), NOT `gh pr review`. The `gh pr review` command creates pending/draft reviews that remain invisible until submitted - Gemini will never see them. **Always include `@gemini-code-assist` in your reply** to ensure Gemini receives a notification.

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
     2. If the failure is coverage-related, add tests to raise coverage and re-run the relevant `test:coverage` target locally
     3. Return to monitoring CI status

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

   **Needs QA post-merge handling**: If `needs_qa` is `true` and `associated_issue_number` is set:

   1. Check if the issue is closed and reopen if necessary:

      ```bash
      gh issue view <associated_issue_number> --json state
      ```

      If `state` is `CLOSED`, reopen it:

      ```bash
      gh issue reopen <associated_issue_number>
      ```

   2. Add the "Needs QA" label to the associated issue:

      ```bash
      gh issue edit <associated_issue_number> --add-label "Needs QA"
      ```

   3. Add a comment to the issue noting the PR was merged:

      ```bash
      gh issue comment <associated_issue_number> --body "PR #<pr-number> has been merged. This issue is now ready for QA verification."
      ```

   This ensures the issue is open and clearly marked for QA follow-up, even if it was previously closed.

6. **Report success**: Confirm the PR was merged and provide a summary:
   - Show the PR URL
   - Output a brief description of what was merged (1-3 sentences summarizing the changes based on the PR title and commits)
   - If `needs_qa` was `true`, mention the associated issue number, whether it was reopened, and that it has been labeled "Needs QA" for follow-up

7. **Auto-exit session**: After reporting success, run the exit script to close the session:

   ```bash
   ./scripts/agents/exitSession.sh
   ```

   This sends `/exit` to the tmux pane after a 2-second delay, allowing the success message to be displayed first.

## Opening GitHub Issues

Create issues for problems that shouldn't block the PR (flaky tests, infrastructure issues, tech debt). Use labels: `flaky-test`, `ci`, `bug`, `enhancement`. Don't let issue creation block the merge - create it and continue.

## Resolving Conversation Threads

All threads must be resolved before merge. Use `/follow-up-with-gemini` which handles replying with commit SHAs, waiting for confirmation, and resolving threads via GraphQL.

## Token Efficiency (CRITICAL - ENFORCE STRICTLY)

Merge queue sessions can run for 30+ minutes. Without strict token discipline, a single session can burn through the entire context window.

### MANDATORY: Suppress stdout on ALL git operations

```bash
# CORRECT - always use these forms
git push --force-with-lease >/dev/null
git push >/dev/null
git commit -S -m "message" >/dev/null
git fetch origin main >/dev/null
git rebase origin/main >/dev/null

# WRONG - NEVER run without stdout suppression
git push                    # Burns 5000+ tokens on pre-push hooks
git push --force-with-lease # Burns 5000+ tokens on pre-push hooks
git commit -S -m "message"  # Burns 1000+ tokens on pre-commit output
git fetch origin main       # Can be noisy and waste tokens
git rebase origin/main      # Can be noisy and waste tokens
```

**Why this is non-negotiable**: Pre-push hooks run lint, type-check, build, and tests. A single unsuppressed push adds 5,000+ lines to context. Over a merge queue session with multiple pushes, this can consume 20,000+ tokens of pure noise.

### Other mandatory token-saving practices

- **Cache immutable PR data**: Fetch `number`, `baseRefName`, `headRefName`, `url` ONCE in step 1. Never re-fetch.
- **Minimal `--json` fields**: Always specify exactly the fields needed:

  ```bash
  # CORRECT
  gh pr view --json state,mergeStateStatus
  gh run list --json status,conclusion,databaseId --limit 1

  # WRONG - fetches unnecessary data
  gh pr view
  gh pr view --json state,mergeStateStatus,title,body,author,labels,...
  ```

- **Don't echo status unnecessarily**: The user sees your tool calls. Don't add "Checking CI status..." messages.
- **Batch state updates**: Combine related status messages rather than outputting each check individually.
- **Avoid verbose CI logs**: Only fetch CI logs on failure, and only the failing job's logs.
- **Skip redundant operations**: Use state flags (`has_waited_for_gemini`, `gemini_can_review`, `has_bumped_version`, `needs_qa`) religiously.
- **No redundant file reads**: If you read a file, cache its content mentally. Don't re-read unchanged files.

## Notes

- Loops until PR is **actually merged**, not just auto-merge enabled
- Non-high-priority PRs yield to high-priority ones unless all are `DIRTY` (check every 2 min with jitter)
- PRs with `needs-qa` label: auto-close language is removed, issue is created if needed, closed issues are reopened, and issue is labeled "Needs QA" after merge
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
