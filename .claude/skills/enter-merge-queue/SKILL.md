---
name: enter-merge-queue
description: Guarantee a PR merges by handling CI, addressing Gemini review feedback, enabling auto-merge, and waiting until the PR is merged. Use when you are asked to babysit a PR through the merge queue, resolve CI failures, handle Gemini review threads, or monitor a PR until merge.
---


# Enter Merge Queue

## CRITICAL: Continuous Loop Until Merged

**This skill MUST run continuously until the PR state is `MERGED`.** Do NOT exit after:

- Running `$address-gemini-feedback` - continue the loop
- Running `$follow-up-with-gemini` - continue the loop
- Running `$fix-tests` - continue the loop
- CI completing successfully - continue to enable auto-merge, then keep polling
- Enabling auto-merge - keep polling until `state` is `MERGED`

**The ONLY valid exit condition is the `getPrInfo` action returning `"state":"MERGED"`.**

**First**: Get PR info using the agentTool wrapper:

```bash
# Get PR number, state, and branch info
./scripts/agents/tooling/agentTool.ts getPrInfo --fields number,state,headRefName,baseRefName
```

This returns JSON with the requested fields. Extract `number` as `PR_NUMBER` for use in subsequent commands.

This skill guarantees a PR gets merged by continuously monitoring CI, addressing reviews, and waiting until the PR is actually merged.

## State Tracking

Track the following state during execution:

- `gemini_can_review`: Boolean, starts `true`. Set to `false` if PR contains only non-code files. Allows skipping Gemini checks entirely.
- `gemini_quota_exhausted`: Boolean, starts `false`. Set to `true` when Gemini reports its daily quota limit.
- `used_fallback_agent_review`: Boolean, starts `false`. Set to `true` after running one fallback review via Claude Code.
- `associated_issue_number`: Number or null. The issue number associated with this PR (either extracted from PR body or newly created). All PRs should have an associated issue that gets marked `needs-qa` after merge.
- `is_rollup_pr`: Boolean, starts `false`. Set to `true` if base branch is not `main`/`master`. Roll-up PRs must wait for their base PR to merge first.
- `base_pr_number`: Number or null. For roll-up PRs, the PR number associated with the base branch.
- `original_base_ref`: String or null. For roll-up PRs, stores the original base branch name before retargeting to main.
- `job_failure_counts`: Map of job name → failure count. Tracks how many times each job has failed across workflow runs. Reset when job succeeds or PR is rebased.
- `current_run_id`: Number or null. The workflow run ID being monitored. Used to detect when a new workflow starts after a fix push.
- `deferred_items`: Array of `{thread_id, path, line, body, html_url}`. Collects review feedback explicitly deferred to a follow-up PR. Populated by `$address-gemini-feedback` when a fix is deferred rather than applied on-the-fly.
- `deferred_fix_issue_number`: Number or null. If deferred items exist, a tracking issue is created with the `deferred-fix` label before merge.

## Polling with Jitter

All polling intervals use jitter to prevent thundering herd when multiple agents run concurrently. Apply ±20% randomization:

```text
actual_wait = base_wait × (0.8 + random() × 0.4)
```

For example, a 30-second base wait becomes 24-36 seconds. A 2-minute wait becomes 96-144 seconds.

## Steps

1. **Verify PR exists and check file types**: Run `./scripts/agents/tooling/agentTool.ts getPrInfo --fields number,title,headRefName,baseRefName,url,state,labels,files,body` to get PR info. If no PR exists, abort with a message. Store the `baseRefName` for use in subsequent steps. Also check if this PR has the `high-priority` label.

   **Tag with tuxedo instance**: Tag the PR with the current workspace name:

   ```bash
   ./scripts/agents/tooling/agentTool.ts tagPrWithTuxedoInstance
   ```

   **Roll-up PR detection**: Check if `baseRefName` is `main` or `master`. If NOT:
   - This is a **roll-up PR** that depends on another PR merging first
   - Set `is_rollup_pr = true` and `original_base_ref = baseRefName`
   - Find the base PR: `./scripts/agents/tooling/agentTool.ts findPrForBranch --branch <baseRefName> --state open`
   - If a PR is found (returns JSON with `number`), store it as `base_pr_number`
   - If no open PR is found for the base branch, check if it was already merged:
     - `./scripts/agents/tooling/agentTool.ts findPrForBranch --branch <baseRefName> --state merged`
     - If merged, proceed as normal (the roll-up PR's base will be updated by GitHub)
   - Log: "Roll-up PR detected. Base PR: #<base_pr_number> (<baseRefName>)"

   **Early Gemini skip detection**: Check the file extensions in the PR. If ALL files are non-code types, set `gemini_can_review = false`:
   - Docs: `.md`, `.txt`, `.rst`
   - Assets: `.png`, `.jpg`, `.svg`, `.ico`, `.gif`
   - Ignore files: `.gitignore`, `.dockerignore`

   Note: Gemini CAN review `.json`, `.yaml`, `.yml`, and other config files - don't skip these.

   **Issue tracking (if applicable)**: If a PR has an associated issue, it gets marked `needs-qa` after merge. Issues are NOT created automatically - only when the user explicitly requests one. Do NOT create separate "QA: ..." issues.

   1. **Check for auto-close language**: Scan the PR body for patterns like `Closes #`, `Fixes #`, `Resolves #` (case-insensitive). If found:
      - Run `./scripts/agents/tooling/agentTool.ts sanitizePrBody --number "$PR_NUMBER"`
      - Read `issue_numbers` from the JSON response
      - Store the first extracted issue number as `associated_issue_number`

   2. **Find associated issue**: If no issue number was extracted from the PR body:
      - Search for an existing issue that references this PR or matches the PR title
      - If no issue found, set `associated_issue_number = null` and proceed (the `needs-qa` label will just be skipped post-merge)

2. **Check current branch**: Ensure you're on the PR's head branch, not `main`.

3. **Main loop** - Repeat until PR is merged:

   **LOOP STRUCTURE**: After completing ANY sub-step below, ALWAYS return to step 4c to re-check PR state. Never exit the loop until `state` is `MERGED`.

   ### 4a. Wait for base PR (roll-up PRs only)

   **Skip this step if `is_rollup_pr` is `false`.**

   If this is a roll-up PR, the base PR must merge before this PR can proceed:

   ```bash
   ./scripts/agents/tooling/agentTool.ts getPrInfo --fields state,mergeStateStatus
   # Run from the base PR's branch, or pass --number if available
   ```

   **If base PR `state` is `MERGED`**:
   - Log: "Base PR #<base_pr_number> has merged. Retargeting to main."
   - GitHub automatically retargets the roll-up PR to `main` when the base PR merges
   - Refresh PR info to get updated `baseRefName`: `./scripts/agents/tooling/agentTool.ts getPrInfo --fields baseRefName`
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
   - Stop and ask user for guidance

   ### 4b. Yield to high-priority PRs

   If the current PR does NOT have the `high-priority` label, check if any other open PRs do.

   **Step 1**: Get the list of high-priority PRs with their merge states:

   ```bash
   ./scripts/agents/tooling/agentTool.ts listHighPriorityPrs
   ```

   This returns JSON array with `number`, `title`, and `mergeStateStatus` for each high-priority PR.

   **Step 3**: Determine whether to yield:

   - **Yield** if any high-priority PR has `mergeStateStatus` of `CLEAN`, `BLOCKED`, `UNKNOWN`, `UNSTABLE`, or `HAS_HOOKS`:
     1. Log: "Yielding to high-priority PR #X (status: Y)"
     2. Wait 2 minutes (with jitter) before rechecking
     3. Repeat from Step 1 until no high-priority PRs require yielding
   - **Proceed normally** if:
     - No high-priority PRs exist, OR
     - All high-priority PRs have `mergeStateStatus` of `DIRTY` (conflicts that need manual resolution)
   - **Skip this check entirely** if the current PR has the `high-priority` label

   ### 4c. Check PR state

   ```bash
   ./scripts/agents/tooling/agentTool.ts getPrInfo --fields state,mergeStateStatus,mergeable
   ```

   - If `state` is `MERGED`: Exit loop and proceed to step 5
   - If `mergeStateStatus` is `BEHIND`: Continue waiting unless a rebase is explicitly needed for another reason
   - If `mergeStateStatus` is `BLOCKED` or `UNKNOWN`: Wait for CI and address Gemini feedback (step 4e)
   - If `mergeStateStatus` is `CLEAN`: Enable auto-merge (step 4f)

   ### 4d. Update from base branch (rebase)

   Use rebase to keep the branch history clean (no merge commits for updates):

   ```bash
   git fetch origin <baseRefName> >/dev/null
   git rebase origin/<baseRefName> >/dev/null
   ```

   - If rebase conflicts occur, the goal is to **preserve BOTH the PR's changes AND main's changes**:

     1. **Version files** (`package.json` versions, `build.gradle`, `project.pbxproj`):
        - Use `git checkout --ours <file>` to keep main's version
        - Version bumps are applied by CI on `main` post-merge, so keep main's version here
        - NOTE: During rebase, `--ours` refers to the branch being rebased ONTO (main), not the PR branch. This is the opposite of `git merge`.

     2. **Lock files** (`pnpm-lock.yaml`):
        - Use `git checkout --ours pnpm-lock.yaml` to keep main's version
        - After rebase completes, run `pnpm install` to regenerate with correct dependencies

     3. **Code files with real conflicts**:
        - Do NOT blindly use `--ours` or `--theirs` - both discard legitimate work
        - Open the conflicted file and resolve by keeping BOTH sets of changes:
          - Keep additions from main (features that landed while PR was open)
          - Keep the PR's changes (the work this PR is delivering)
        - If changes are on the exact same lines and truly incompatible:
          - Run `git rebase --abort` to restore the branch
          - Stop and ask user for guidance - do NOT auto-resolve in a way that discards either side's work

   **Reset job failure counts after rebase**: Clear `job_failure_counts` (new base = fresh start for CI).

   Do not run `bumpVersion.sh` on PR branches. Version bumping is handled by CI on `main` after merge.

   Force push (required after rebase):

   ```bash
   git push --force-with-lease >/dev/null
   ```

   Continue to step 4e.

   ### 4e. Wait for CI with early job failure detection

   **IMPORTANT**: Poll individual job statuses to detect failures early. React to failures immediately instead of waiting for the entire workflow to complete. This saves significant time when fast jobs (lint, build) fail while slow jobs (iOS Maestro) are still running.

   **Skip Gemini handling entirely if** `gemini_can_review` is `false` (detected in step 1).

   #### Gemini reply guidelines

   Gemini Code Assist is a GitHub App that automatically reviews PRs - do NOT use `gh pr edit --add-reviewer` as it doesn't work with GitHub App bots.

   **CRITICAL - Reply in-thread only**: When replying to Gemini comments, use the agentTool wrappers:
   - Get review threads: `./scripts/agents/tooling/agentTool.ts getReviewThreads --number <pr-number> [--unresolved-only]`
   - Reply in-thread: `./scripts/agents/tooling/agentTool.ts replyToComment --number <pr-number> --comment-id <comment_database_id> --body "...@gemini-code-assist ..."`
   - Reply with commit hash (Gemini-specific): `./scripts/agents/tooling/agentTool.ts replyToGemini --number <pr-number> --comment-id <comment_database_id> --commit <sha>`

   Top-level PR comments are not acceptable for review feedback. The `gh pr review` command creates pending/draft reviews that remain invisible until submitted - Gemini will never see them. **Always include `@gemini-code-assist` in your reply** to ensure Gemini receives a notification. **Include the relevant commit message(s)** in the reply.
   When reporting a fix, **include the commit hash and explicitly ask if it addresses the issue** (e.g., "Commit <hash> ... does this address the issue?").
   **Sentiment check**: If Gemini's response is an approval/confirmation without new requests, resolve the thread:

   ```bash
   ./scripts/agents/tooling/agentTool.ts resolveThread --thread-id <thread_node_id>
   ```

   If it is uncertain or requests more changes, keep the thread open and iterate.

   #### Unsupported file types response

   If Gemini's review contains:
   > "Gemini is unable to generate a review for this pull request due to the file types involved not being currently supported."

   Set `gemini_can_review = false` and skip Gemini checks for the remainder of this session.

   #### Daily quota exhaustion response

   Quota exhaustion can happen at ANY point - during initial review OR during follow-up interactions after an initial review was already provided. Check for this pattern in ALL Gemini responses:
   > "You have reached your daily quota limit. Please wait up to 24 hours and I will start processing your requests again!"

   When detected at any point:
   - Set `gemini_quota_exhausted = true`
   - Set `gemini_can_review = false` for this session
   - If `used_fallback_agent_review` is still `false`, run one cross-agent fallback review (Codex):

   ```bash
   ./scripts/agents/tooling/agentTool.ts solicitCodexReview
   ```

   - Tag the PR with the fallback reviewer:

     ```bash
     ./scripts/agents/tooling/agentTool.ts tagPrWithReviewer --reviewer codex
     ```

   - Set `used_fallback_agent_review = true`
   - Treat this single fallback review as sufficient to get past the review step in the loop (do not block on additional Gemini responses during this session)
   - Any unresolved Gemini threads from before quota exhaustion should be resolved by the agent based on whether the feedback was already addressed in code

   #### Job-level CI polling (early failure detection)

   **Important**: Monitor CI and review state continuously to avoid waiting on stale assumptions.

   **Step 1**: Get the workflow run status for the current commit:

   ```bash
   COMMIT=$(git rev-parse HEAD)
   ./scripts/agents/tooling/agentTool.ts getCiStatus --commit "$COMMIT"
   ```

   This returns JSON with `run_id`, `status`, `conclusion`, and `jobs` array. Store the `run_id` as `current_run_id`. If the run ID changes (new workflow started), update `current_run_id`.

   **Step 2**: Poll individual job statuses using the run ID:

   ```bash
   ./scripts/agents/tooling/agentTool.ts getCiStatus --run-id "$RUN_ID"
   ```

   Returns `{status, conclusion, jobs: [{name, status, conclusion}, ...]}`.

   **Job priority order** (process failures in this order - fastest jobs first):
   1. `build` (~15 min) - lint, types, coverage
   2. `web-e2e` (~10 min) - Playwright tests
   3. `electron-e2e` (~10 min) - Electron tests
   4. `android-maestro-release` (~20 min) - Android Maestro
   5. `ios-maestro-release` (~30 min) - iOS Maestro (slowest)

   **Adaptive polling intervals** (with jitter):
   - First 5 minutes: Poll every 1 minute (catch fast lint/type failures)
   - 5-15 minutes: Poll every 2 minutes
   - After 15 minutes: Poll every 3 minutes

   #### At each poll iteration

   1. **Check current merge state**: `./scripts/agents/tooling/agentTool.ts getPrInfo --fields mergeStateStatus`
      - If `mergeStateStatus` changes, adjust monitoring behavior accordingly.

   2. **Handle Gemini feedback** (if `gemini_can_review` is `true`):
      - Always run Gemini evaluation and close-out checks on every poll iteration, including when CI jobs are still running or have failed.
      - Run `$address-gemini-feedback` to fetch and address unresolved comments.
      - If code changes were made, push and **verify push completed before replying**:

        ```bash
        ./scripts/agents/tooling/agentTool.ts verifyBranchPush
        ```

        **Do NOT run `$follow-up-with-gemini` until push is verified.** Replying with "Fixed in commit X" when X is not visible on remote creates confusion.
      - Once push is verified, run `$follow-up-with-gemini` to close threads Gemini has confirmed as addressed.
      - After Gemini review is successfully addressed, tag the PR: `./scripts/agents/tooling/agentTool.ts tagPrWithReviewer --reviewer gemini`
      - If sentiment indicates Gemini daily quota exhaustion, stop Gemini follow-ups and run the one-time Claude Code fallback review above.
      - **IMPORTANT**: Do not wait for CI completion to resolve review threads. After these sub-skills complete, continue the polling loop - do NOT exit.

   3. **Check individual job statuses** (in priority order):

      For each job:
      - If `status="completed"` AND `conclusion="success"`:
        - Reset `job_failure_counts[job] = 0`

      - If `status="completed"` AND `conclusion="failure"`:
        - Increment `job_failure_counts[job]`
        - If `job_failure_counts[job] >= 3` (failed 3 times = initial + 2 retries):
          - Log: "Job '<job-name>' failed 3 times. Asking user for help."
          - Stop and ask user for guidance
        - Else:
          - Log: "Job '<job-name>' failed (attempt X/3). Starting fix."
          - Run `$fix-tests <job-name>` targeting the specific job
          - If fix was pushed:
            - Cancel the obsolete workflow: `./scripts/agents/tooling/agentTool.ts cancelWorkflow --run-id "$RUN_ID"`
            - Log: "Cancelled obsolete workflow. New CI starting."
            - Break out of job loop (new workflow will start, pick it up next poll)

   4. **Check overall workflow status**:
      - If ALL jobs completed AND ALL succeeded → continue to step 4f
      - If ANY jobs still running → wait (with jitter) and repeat from step 4e.1

   #### Workflow cancellation

   After pushing a fix, cancel the obsolete workflow to save CI minutes:

   ```bash
   ./scripts/agents/tooling/agentTool.ts cancelWorkflow --run-id "$RUN_ID"
   ```

   **Why cancel?**
   - Saves CI minutes (no point running tests against stale code)
   - New workflow automatically starts when fix is pushed
   - Prevents confusion from multiple simultaneous workflows

   **Safety**: Only cancel after confirming the push succeeded.

   #### When CI is cancelled (externally)

   If the workflow was cancelled (not by us), rerun it:

   ```bash
   ./scripts/agents/tooling/agentTool.ts rerunWorkflow --run-id "$RUN_ID"
   ```

   ### 4f. Enable auto-merge and wait

   **Version bump note**: Do not perform PR-branch version bumps here; CI on `main` owns release version increments.

   Enable auto-merge:

   ```bash
   ./scripts/agents/tooling/agentTool.ts enableAutoMerge --number "$PR_NUMBER"
   ```

   Then poll for merge completion (30 seconds with jitter). **Keep polling until merged**:

   ```bash
   ./scripts/agents/tooling/agentTool.ts getPrInfo --fields state,mergeStateStatus
   ```

   - If `state` is `MERGED`: Exit loop and proceed to step 5
   - If `mergeStateStatus` is `BEHIND`: Continue polling unless a rebase is explicitly needed
   - If `mergeStateStatus` is `BLOCKED`: Go back to step 4e (CI not done yet)
   - Otherwise: Wait 30 seconds (with jitter) and poll again - **do NOT exit**

4. **Refresh workspace**: Once the PR is merged, run:

   ```bash
   ./scripts/agents/tooling/agentTool.ts refresh
   ```

   This sets the VS Code window title to "ready" and switches back to main with the latest changes.

   **Post-merge QA handling**: If `associated_issue_number` is set:

   1. Add the "needs-qa" label to the associated issue:

      ```bash
      ./scripts/agents/tooling/agentTool.ts addLabel --type issue --number <associated_issue_number> --label "needs-qa"
      ```

   That's it. The issue already describes the work; no need to update descriptions or add comments.

   **Post-merge deferred fix handling**: If `deferred_items` is non-empty:

   1. Create a tracking issue with the `deferred-fix` label:

      ```bash
      DEFERRED_ITEMS_JSON=$(printf '%s\n' "${deferred_items[@]}" | jq -s '.')
      ./scripts/agents/tooling/agentTool.ts createDeferredFixIssue \
        --number "$PR_NUMBER" \
        --pr-url "$PR_URL" \
        --deferred-items-json "$DEFERRED_ITEMS_JSON"
      ```

   2. Store the new issue number as `deferred_fix_issue_number`

   **IMPORTANT**: Only create deferred fix issues for items explicitly deferred. Do NOT create issues for feedback that was addressed on-the-fly during the PR review cycle.

5. **Report success**: Confirm the PR was merged and provide a summary:
   - Show the PR URL
   - Output a brief description of what was merged (1-3 sentences summarizing the changes based on the PR title and commits)
   - If an associated issue exists, mention it was labeled `needs-qa`
   - If a deferred fix issue was created, mention it with its number and link

## Opening GitHub Issues

Create issues for problems that shouldn't block the PR (flaky tests, infrastructure issues, tech debt). Use labels: `flaky-test`, `ci`, `bug`, `enhancement`. Don't let issue creation block the merge - create it and continue.

## Resolving Conversation Threads

All threads must be resolved before merge, and close-out should happen continuously during CI polling rather than after CI completion. Use `$follow-up-with-gemini` after each `$address-gemini-feedback` pass to resolve confirmed threads in-loop.

## Token Efficiency (CRITICAL - ENFORCE STRICTLY)

Merge queue sessions can run for 30+ minutes. Without strict token discipline, a single session can burn through the entire context window.

### MANDATORY: Suppress stdout on ALL git operations

```bash
# CORRECT - always use these forms
git push --force-with-lease >/dev/null
git push >/dev/null
git commit -S -m "message" >/dev/null
git fetch origin <baseRefName> >/dev/null
git rebase origin/<baseRefName> >/dev/null

# WRONG - NEVER run without stdout suppression
git push                    # Burns 5000+ tokens on pre-push hooks
git push --force-with-lease # Burns 5000+ tokens on pre-push hooks
git commit -S -m "message"  # Burns 1000+ tokens on pre-commit output
git fetch origin <baseRefName>       # Can be noisy and waste tokens
git rebase origin/<baseRefName>      # Can be noisy and waste tokens
```

**Why this is non-negotiable**: Pre-push hooks run lint, type-check, build, and tests. A single unsuppressed push adds 5,000+ lines to context. Over a merge queue session with multiple pushes, this can consume 20,000+ tokens of pure noise.

### MANDATORY: Suppress Local Test Output

If you must run tests locally (e.g., to verify a fix before pushing), YOU MUST suppress output. We run a LOT of tests and cannot afford to burn tokens on standard output.

```bash
# CORRECT
pnpm test >/dev/null 2>&1
pnpm lint >/dev/null 2>&1

# WRONG
pnpm test
pnpm lint
```

### Other mandatory token-saving practices

- **Cache immutable PR data**: Fetch `number`, `baseRefName`, `headRefName`, `url` ONCE in step 1. Never re-fetch.
- **Minimal `--json` fields**: Always specify exactly the fields needed:

  ```bash
  # CORRECT
  gh pr view "$PR_NUMBER" --json state,mergeStateStatus -R "$REPO"
  ./scripts/agents/tooling/agentTool.ts getCiStatus --commit "$(git rev-parse HEAD)"

  # WRONG - fetches unnecessary data
  gh pr view
  gh pr view --json state,mergeStateStatus,title,body,author,labels,...
  ```

- **Don't echo status unnecessarily**: The user sees your tool calls. Don't add "Checking CI status..." messages.
- **Batch state updates**: Combine related status messages rather than outputting each check individually.
- **Avoid verbose CI logs**: Only fetch CI logs on failure. ALWAYS use `--log-failed` to fetch only the relevant error context. Never dump full logs.
- **Skip redundant operations**: Use state flags (`gemini_can_review`) religiously.
- **No redundant file reads**: If you read a file, cache its content mentally. Don't re-read unchanged files.

## Notes

- Loops until PR is **actually merged**, not just auto-merge enabled
- Non-high-priority PRs yield to high-priority ones unless all are `DIRTY` (check every 2 min with jitter)
- Auto-close language is removed from PR bodies; associated issues get `needs-qa` label after merge
- Do NOT create "QA: ..." issues - issues are only created when explicitly requested by the user OR for deferred fixes
- **Deferred fixes**: Create issues ONLY for review feedback explicitly deferred to a follow-up PR. Do NOT create issues for feedback fixed on-the-fly during the review cycle.
- Prioritize continuous CI/review monitoring in congested queues
- Fixable: lint/type errors, test failures. Non-fixable: merge conflicts, infra failures
- If stuck (same job fails 3 times after 2 fix attempts), ask user for help
- Gemini confirmation detection: positive phrases ("looks good", "lgtm", etc.) WITHOUT negative qualifiers ("but", "however", "still")
- Only resolve threads after explicit Gemini confirmation
- If Gemini hits daily quota, run one Claude Code fallback review and treat it as sufficient for the review step
- **Roll-up PRs**: PRs targeting a non-main branch wait for their base PR to merge first. Once merged, GitHub auto-retargets to main and the roll-up continues normally.

## Keeping PR Description Updated

As you iterate, update the PR body with `./scripts/agents/tooling/agentTool.ts updatePrBody --number "$PR_NUMBER" --body-file <path>`. Always remove auto-close language (`Closes/Fixes/Resolves #...`) and track the issue separately - all issues are marked `needs-qa` after merge. Always preserve the Claude-style format:

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

Follow commit guidelines in `CLAUDE.md`: conventional commits, GPG signed with 5s timeout, no co-author lines or footers. **Header must be ≤ 50 characters** (enforced by commitlint `header-max-length`). The header is the entire first line: `type(scope): description`. If too long, shorten the scope or description:

- Drop the scope: `feat: add redis and garage reset scripts`
- Abbreviate: `feat(scripts): add reset scripts` (put details in body)
- Use a broader verb: `feat(scripts): add stack reset tooling`
