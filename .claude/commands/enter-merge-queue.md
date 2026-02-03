---
description: Guarantee PR merge by cycling until merged
---

# Enter Merge Queue

**First**: Determine the repository for all `gh` commands:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
```

Use `-R "$REPO"` with `gh` commands that require explicit repo context (e.g., `gh issue`, `gh api`). However, do NOT use `-R` with `gh pr view` when inferring from the current branch - it requires an explicit PR number when `-R` is used. Instead, run `gh pr view` without `-R` to use the current branch context, or specify the PR number explicitly: `gh pr view <number> -R "$REPO"`.

This skill guarantees a PR gets merged by continuously updating from base, fixing CI, addressing reviews, and waiting until the PR is actually merged.

## State Tracking

Track the following state during execution:

- `has_bumped_version`: Boolean, starts `false`. Set to `true` after version bump is applied. This ensures we only bump once per PR, even if we loop through multiple CI fixes or rebases.
- `gemini_can_review`: Boolean, starts `true`. Set to `false` if PR contains only non-code files. Allows skipping Gemini checks entirely.
- `associated_issue_number`: Number or null. The issue number associated with this PR (either extracted from PR body or newly created). All PRs should have an associated issue that gets marked `needs-qa` after merge.
- `is_rollup_pr`: Boolean, starts `false`. Set to `true` if base branch is not `main`/`master`. Roll-up PRs must wait for their base PR to merge first.
- `base_pr_number`: Number or null. For roll-up PRs, the PR number associated with the base branch.
- `original_base_ref`: String or null. For roll-up PRs, stores the original base branch name before retargeting to main.

## Polling with Jitter

All polling intervals use jitter to prevent thundering herd when multiple agents run concurrently. Apply ±20% randomization:

```text
actual_wait = base_wait × (0.8 + random() × 0.4)
```

For example, a 30-second base wait becomes 24-36 seconds. A 2-minute wait becomes 96-144 seconds.

## Steps

1. **Verify PR exists and check file types**: Run `gh pr view --json number,title,headRefName,baseRefName,url,state,labels,files,body` to get PR info. If no PR exists, abort with a message. Store the `baseRefName` for use in subsequent steps. Also check if this PR has the `high-priority` label.

   **Roll-up PR detection**: Check if `baseRefName` is `main` or `master`. If NOT:
   - This is a **roll-up PR** that depends on another PR merging first
   - Set `is_rollup_pr = true` and `original_base_ref = baseRefName`
   - Find the base PR: `gh pr list --head <baseRefName> --state open --json number --jq '.[0].number'`
   - If a PR is found, store it as `base_pr_number`
   - If no open PR is found for the base branch, check if it was already merged:
     - `gh pr list --head <baseRefName> --state merged --json number --jq '.[0].number'`
     - If merged, proceed as normal (the roll-up PR's base will be updated by GitHub)
   - Log: "Roll-up PR detected. Base PR: #<base_pr_number> (<baseRefName>)"

   **Early Gemini skip detection**: Check the file extensions in the PR. If ALL files are non-code types, set `gemini_can_review = false`:
   - Config files: `.json`, `.yaml`, `.yml`, `.toml`, `.ini`, `.env*`
   - Docs: `.md`, `.txt`, `.rst`
   - Assets: `.png`, `.jpg`, `.svg`, `.ico`, `.gif`
   - Build/CI: `Dockerfile`, `.dockerignore`, `.gitignore`

   This avoids waiting 5 minutes for Gemini to respond with "unsupported file types".

   **Issue tracking (if applicable)**: If a PR has an associated issue, it gets marked `needs-qa` after merge. Issues are NOT created automatically - only when the user explicitly requests one. Do NOT create separate "QA: ..." issues.

   1. **Check for auto-close language**: Scan the PR body for patterns like `Closes #`, `Fixes #`, `Resolves #` (case-insensitive). If found:
      - Extract the issue number(s) from the pattern
      - Remove ALL auto-close language from the PR body using `gh pr edit --body`
      - Store the first extracted issue number as `associated_issue_number`

   2. **Find associated issue**: If no issue number was extracted from the PR body:
      - Search for an existing issue that references this PR or matches the PR title
      - If no issue found, set `associated_issue_number = null` and proceed (the `needs-qa` label will just be skipped post-merge)

2. **Check current branch**: Ensure you're on the PR's head branch, not `main`.

3. **Mark as queued**: Set the VS Code title and tmux window name to show queued status, and move the tmux window to the front of the list:

   ```bash
   setQueued.sh "(queued) #<pr-number> - <branch>"
   ```

4. **Main loop** - Repeat until PR is merged:

   ### 4a. Wait for base PR (roll-up PRs only)

   **Skip this step if `is_rollup_pr` is `false`.**

   If this is a roll-up PR, the base PR must merge before this PR can proceed:

   ```bash
   gh pr view <base_pr_number> --json state,mergeStateStatus
   ```

   **If base PR `state` is `MERGED`**:
   - Log: "Base PR #<base_pr_number> has merged. Retargeting to main."
   - GitHub automatically retargets the roll-up PR to `main` when the base PR merges
   - Refresh PR info to get updated `baseRefName`: `gh pr view --json baseRefName`
   - Set `is_rollup_pr = false` (now a normal PR targeting main)
   - Rebase onto main to incorporate base PR changes:

     ```bash
     git fetch origin main >/dev/null
     git rebase origin/main >/dev/null
     git push --force-with-lease >/dev/null
     ```

   - Continue to step 4b

   **If base PR `state` is `OPEN`**:
   - Check `mergeStateStatus`:
     - If `CLEAN` or `BLOCKED` or `UNKNOWN`: Base PR is progressing, wait for it
     - If `DIRTY`: Base PR has conflicts - alert user: "Base PR #<base_pr_number> has conflicts. Please resolve before this roll-up can proceed."
     - If `BEHIND`: Base PR needs to update - this is normal, wait for it
   - Log: "Waiting for base PR #<base_pr_number> to merge (status: <mergeStateStatus>)"
   - Wait 2 minutes (with jitter) and repeat this step

   **If base PR `state` is `CLOSED`** (not merged):
   - Alert user: "Base PR #<base_pr_number> was closed without merging. This roll-up PR cannot proceed."
   - Clear queued status with `clearQueued.sh`
   - Stop and ask user for guidance

   ### 4b. Yield to high-priority PRs

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

   ### 4c. Check PR state

   ```bash
   gh pr view --json state,mergeStateStatus,mergeable
   ```

   - If `state` is `MERGED`: Exit loop and proceed to step 5
   - If `mergeStateStatus` is `BEHIND`: Update from base and bump version (step 4d)
   - If `mergeStateStatus` is `BLOCKED` or `UNKNOWN`: Wait for CI and address Gemini feedback (step 4e)
   - If `mergeStateStatus` is `CLEAN`: Enable auto-merge (step 4f)

   ### 4d. Update from base branch (rebase) and bump version

   Use rebase to keep the branch history clean (no merge commits for updates):

   ```bash
   git fetch origin <baseRefName>
   git rebase origin/<baseRefName>
   ```

   - If rebase conflicts occur:
     1. **Preserve main branch changes** (features already merged to main must not be reverted):
        - List conflicts: `git diff --name-only --diff-filter=U`
        - For each conflicted file, **keep the main branch version**: `git checkout --ours <file>`
          - NOTE: During rebase, `--ours` refers to the branch being rebased ONTO (main), not the PR branch. This is the opposite of `git merge`.
        - Stage all resolved files: `git add <file>`
        - Continue: `git rebase --continue`
     2. If conflicts persist or require manual intervention:
        - Run `git rebase --abort` to restore the branch
        - List the conflicting files
        - Clear the queued status with `clearQueued.sh`
        - Stop and ask the user for help - do NOT automatically resolve in a way that could revert merged features.

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

   Continue to step 4e.

   ### 4e. Wait for CI and address Gemini feedback (interleaved)

   **IMPORTANT**: Handle Gemini feedback checking as part of each CI polling iteration. Do NOT block waiting for Gemini's initial review - check opportunistically while polling CI.

   **Skip Gemini handling entirely if** `gemini_can_review` is `false` (detected in step 1).

   #### Gemini reply guidelines

   Gemini Code Assist is a GitHub App that automatically reviews PRs - do NOT use `gh pr edit --add-reviewer` as it doesn't work with GitHub App bots.

   **CRITICAL - Reply in-thread only**: When replying to Gemini comments, use the review comment endpoint, NOT `gh pr review` and NOT `gh pr comment`:
   - List review comments: `gh api /repos/$REPO/pulls/<pr-number>/comments`
   - Reply in-thread: `gh api -X POST /repos/$REPO/pulls/<pr-number>/comments -F in_reply_to=<comment_id> -f body="...@gemini-code-assist ..."`
   For general PR comments (issue comments), list and reply separately:
   - List issue comments: `gh api /repos/$REPO/issues/<pr-number>/comments`
   - Reply with a new PR comment: `gh api -X POST /repos/$REPO/issues/<pr-number>/comments -f body="...@gemini-code-assist ..."`
   Top-level PR comments are not acceptable for review feedback. The `gh pr review` command creates pending/draft reviews that remain invisible until submitted - Gemini will never see them. **Always include `@gemini-code-assist` in your reply** to ensure Gemini receives a notification. **Include the relevant commit message(s)** in the reply.
   When reporting a fix, **include the commit hash and explicitly ask if it addresses the issue** (e.g., "Commit <hash> ... does this address the issue?").
   **Sentiment check**: If Gemini's response is an approval/confirmation without new requests, resolve the thread. If it is uncertain or requests more changes, keep the thread open and iterate.

   #### Unsupported file types response

   If Gemini's review contains:
   > "Gemini is unable to generate a review for this pull request due to the file types involved not being currently supported."

   Set `gemini_can_review = false` and skip Gemini checks for the remainder of this session.

   #### CI and Gemini polling loop

   **Important**: Check if branch is behind BEFORE waiting for CI, and periodically during CI. This prevents wasting time on CI runs that will be obsolete.

   ```bash
   git rev-parse HEAD
   gh run list --commit <commit-sha> --limit 1 --json status,conclusion,databaseId
   ```

   **Adaptive polling intervals** (with jitter):
   - First 5 minutes: Poll every 1 minute (CI might fail fast on lint/type errors)
   - 5-15 minutes: Poll every 2 minutes
   - After 15 minutes: Poll every 3 minutes

   **At each poll iteration**:
   1. Check if branch is behind: `gh pr view --json mergeStateStatus`
      - If `mergeStateStatus` is `BEHIND`: **Immediately** go back to step 4d (don't wait for CI to finish)
   2. If `gemini_can_review` is `true`, check for unresolved Gemini threads:
      - Run `/address-gemini-feedback` to fetch and address any unresolved comments
      - If code changes were made, push and continue polling (CI will restart)
      - If Gemini has responded with confirmations, resolve those threads via `/follow-up-with-gemini`
   3. Check CI status and continue polling if still running

   This interleaved approach addresses Gemini feedback while waiting for CI, reducing total merge time.

   **When CI completes**:
   - If CI **passes**: Continue to step 4f (enable auto-merge)
   - If CI is **cancelled**: Rerun CI using the CLI (do NOT push empty commits):

     ```bash
     gh run rerun <run-id>
     ```

   - If CI **fails**:
     1. Run `/fix-tests` to diagnose and fix the failure
     2. If the failure is coverage-related, add tests to raise coverage and re-run the relevant `test:coverage` target locally
     3. Return to monitoring CI status

   ### 4f. Enable auto-merge and wait

   **Version bump note**: If `has_bumped_version` is still `false` at this point (a rare edge case, e.g., if the PR started `CLEAN`), perform the version bump now. Run the bump script, stage the version files, amend the last commit, and **force push** the changes. Then, return to step 4e to wait for the new CI run.

   Enable auto-merge:

   ```bash
   gh pr merge --auto --squash
   ```

   Then poll for merge completion (30 seconds with jitter):

   ```bash
   gh pr view --json state,mergeStateStatus
   ```

   - If `state` is `MERGED`: Exit loop
   - If `mergeStateStatus` is `BEHIND`: Go back to step 4d
   - Otherwise: Wait and check again

5. **Refresh workspace**: Once the PR is merged, run:

   ```bash
   refresh.sh
   ```

   This sets the VS Code window title to "ready" and switches back to main with the latest changes.

   **Post-merge QA handling**: If `associated_issue_number` is set:

   1. Add the "needs-qa" label to the associated issue:

      ```bash
      gh issue edit <associated_issue_number> --add-label "needs-qa"
      ```

   That's it. The issue already describes the work; no need to update descriptions or add comments.

6. **Report success**: Confirm the PR was merged and provide a summary:
   - Show the PR URL
   - Output a brief description of what was merged (1-3 sentences summarizing the changes based on the PR title and commits)
   - If an associated issue exists, mention it was labeled `needs-qa`

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
- **Skip redundant operations**: Use state flags (`gemini_can_review`, `has_bumped_version`) religiously.
- **No redundant file reads**: If you read a file, cache its content mentally. Don't re-read unchanged files.

## Notes

- Loops until PR is **actually merged**, not just auto-merge enabled
- Non-high-priority PRs yield to high-priority ones unless all are `DIRTY` (check every 2 min with jitter)
- Auto-close language is removed from PR bodies; associated issues get `needs-qa` label after merge
- Do NOT create "QA: ..." issues - issues are only created when explicitly requested by the user
- Prioritize staying up-to-date over waiting for CI in congested queues
- Fixable: lint/type errors, test failures. Non-fixable: merge conflicts, infra failures
- If stuck (same fix attempted twice), ask user for help
- Gemini confirmation detection: positive phrases ("looks good", "lgtm", etc.) WITHOUT negative qualifiers ("but", "however", "still")
- Only resolve threads after explicit Gemini confirmation
- **Roll-up PRs**: PRs targeting a non-main branch wait for their base PR to merge first. Once merged, GitHub auto-retargets to main and the roll-up continues normally.

## Keeping PR Description Updated

As you iterate, update the PR body with `gh pr edit --body`. Always remove auto-close language (`Closes/Fixes/Resolves #...`) and track the issue separately - all issues are marked `needs-qa` after merge. Always preserve the Claude-style format:

```text
## Summary
- <verb-led, concrete change>

## Testing
- <command run or "not run (reason)">

## Issue
- #<issue-number>

Agent: <agent-id>
```

If there is no associated issue, use `## Related` instead of `## Issue`.

When updating the body, recompute the agent id and ensure the PR body ends with the evaluated value:

```bash
AGENT_ID=$(basename "$(git rev-parse --show-toplevel)")
```

Then ensure the PR body ends with `Agent: ${AGENT_ID}`. Add bullets for significant changes (CI fixes, Gemini feedback addressed).

## Commit Rules

Follow commit guidelines in `CLAUDE.md`: conventional commits, GPG signed with 5s timeout, no co-author lines or footers.
