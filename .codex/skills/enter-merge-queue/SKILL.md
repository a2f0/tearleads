---
name: enter-merge-queue
description: Guarantee a PR merges by repeatedly rebasing from the base branch, fixing CI, addressing Gemini review feedback, enabling auto-merge, and waiting until the PR is merged. Use when you are asked to babysit a PR through the merge queue, resolve CI failures, handle Gemini review threads, or keep a branch up to date until merge.
---

# Enter Merge Queue

Ensure a PR merges by looping through base updates, review handling, CI monitoring, and auto-merge until the PR is actually merged.

## Setup

Determine the repository for all `gh` commands:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
PR_NUMBER=$(gh pr view --json number --jq '.number')
```

Always pass `-R "$REPO"` to `gh` commands.

Track these state flags:

- `has_bumped_version`: Boolean, starts `false`. Set to `true` after version bump is applied.
- `has_waited_for_gemini`: Boolean, starts `false`. Set to `true` after waiting once for Gemini.
- `gemini_can_review`: Boolean, starts `true`. Set to `false` if PR contains only non-code files.
- `gemini_quota_exhausted`: Boolean, starts `false`. Set to `true` when Gemini reports its daily quota limit.
- `used_fallback_agent_review`: Boolean, starts `false`. Set to `true` after running one fallback review via Claude Code.
- `associated_issue_number`: Number or null. Track the issue to mark `needs-qa` after merge.
- `job_failure_counts`: Map of job name → failure count. Tracks how many times each job has failed. Reset when job succeeds or PR is rebased.
- `current_run_id`: Number or null. The workflow run ID being monitored.

Use polling jitter with ±20% randomization:

```text
actual_wait = base_wait × (0.8 + random() × 0.4)
```

## Workflow

1. Verify the PR exists and collect metadata.

   ```bash
   gh pr view "$PR_NUMBER" --json number,title,headRefName,baseRefName,url,state,labels,files,body -R "$REPO"
   ```

   - Store `baseRefName` for rebase.
   - Detect `high-priority` label.
   - If all files are non-code types, set `gemini_can_review = false`:
     - Docs: `.md`, `.txt`, `.rst`
     - Assets: `.png`, `.jpg`, `.svg`, `.ico`, `.gif`
     - Ignore files: `.gitignore`, `.dockerignore`
     - Note: Gemini CAN review `.json`, `.yaml`, `.yml`, and other config files - don't skip these.

   Handle issue tracking (if applicable):

   - Remove auto-close language from PR body (`Closes #`, `Fixes #`, `Resolves #`).
   - If an issue is referenced, store the issue number as `associated_issue_number`.
   - Do NOT create issues automatically - issues are only created when the user explicitly requests one.

2. Ensure you are on the PR head branch, not `main`.

3. Mark as queued in the UI and move the tmux window to the front:

   ```bash
   setQueued.sh "(queued) #<pr-number> - <branch>"
   ```

4. Main loop until PR is merged:

   4a. Yield to high-priority PRs unless the current PR has `high-priority`.

   - List high-priority PRs and check their `mergeStateStatus`.
   - Yield if any high-priority PR is `CLEAN`, `BLOCKED`, `BEHIND`, `UNKNOWN`, `UNSTABLE`, or `HAS_HOOKS`.
   - Skip yielding if all high-priority PRs are `DIRTY`.

   4b. Check merge status:

   ```bash
   gh pr view "$PR_NUMBER" --json state,mergeStateStatus,mergeable -R "$REPO"
   ```

   - `MERGED`: exit loop.
   - `BEHIND`: update from base (4c).
   - `BLOCKED` or `UNKNOWN`: handle Gemini feedback while waiting for CI (4d/4e).
   - `CLEAN`: enable auto-merge (4f).
   - **Note**: You can merge your own PRs once the branch is up to date, all required checks pass, and Gemini feedback is fully addressed. If blocked, confirm those three conditions before waiting longer.

   4c. Rebase on base and bump version once:

   ```bash
   git fetch origin <baseRefName> >/dev/null
   git rebase origin/<baseRefName> >/dev/null
   ```

   If rebase conflicts:
   - **Preserve main branch changes** (features already merged to main must not be reverted):
     - List conflicts: `git diff --name-only --diff-filter=U`
     - For each conflicted file, **keep the main branch version**: `git checkout --ours <file>`
       - NOTE: During rebase, `--ours` refers to the branch being rebased ONTO (main), not the PR branch. This is the opposite of `git merge`.
     - Stage all resolved files: `git add <file>`
     - Continue: `git rebase --continue`
   - If conflicts persist or require manual intervention:
     - Run `git rebase --abort` to restore the branch
     - List the conflicting files
     - Clear the queued status with `clearQueued.sh`
     - Stop and ask the user for help - do NOT automatically resolve in a way that could revert merged features.

   Reset `job_failure_counts` after rebase (new base = fresh start).

   If `has_bumped_version` is `false`, run `bumpVersion.sh`, stage the version files, amend the last commit with a GPG-signed message, and set `has_bumped_version = true`. Force push after rebase:

   ```bash
   git push --force-with-lease >/dev/null
   ```

   4d. Address Gemini feedback (parallel with CI):

   **IMPORTANT**: Do NOT wait for CI to complete before addressing Gemini feedback. Handle Gemini feedback while CI is running to maximize efficiency.

   **Initial Gemini check** (if `has_waited_for_gemini` is `false`):

   ```bash
   gh pr view "$PR_NUMBER" --json reviews -R "$REPO"
   ```

   Poll every 30 seconds (with jitter) for up to 5 minutes for `gemini-code-assist`. Set `has_waited_for_gemini = true` after first review is found.

   If Gemini reports unsupported file types, set `gemini_can_review = false` and continue to CI.

   If Gemini reports daily quota exhaustion with text like:
   > "You have reached your daily quota limit. Please wait up to 24 hours and I will start processing your requests again!"

   then:
   - Set `gemini_quota_exhausted = true`
   - Set `gemini_can_review = false` for this session
   - Run one cross-agent fallback review:

   ```bash
   ./scripts/solicitClaudeCodeReview.sh
   ```

   - Set `used_fallback_agent_review = true`
   - Treat this single fallback review as sufficient to pass the review step for this loop iteration (do not block on further Gemini responses in this session)

   **Address feedback while CI runs**:

   - Use `/address-gemini-feedback` and `/follow-up-with-gemini`.
   - Reply **only inside the review thread**:
     - List review comments: `gh api /repos/$REPO/pulls/<pr-number>/comments`
     - Reply in-thread: `gh api -X POST /repos/$REPO/pulls/<pr-number>/comments -F in_reply_to=<comment_id> -f body="...@gemini-code-assist ..."`
   - **Never reply in the PR body or top-level PR comments** for review feedback.
     - Do **not** use `gh pr edit --body` or `gh pr comment` to answer reviewer feedback.
     - Do **not** use issue comments (`/repos/$REPO/issues/<pr-number>/comments`) for review feedback.
   - **Push commits before tagging Gemini with a hash** so the hash links on GitHub and is reviewable.
   - When replying that a fix is complete, **include the commit hash (not just the message) and explicitly ask if the change addresses the issue** (e.g., "Commit <hash> ... does this address the issue?").
   - Analyze Gemini's sentiment in follow-up replies:
     - If Gemini confirms/approves and does not request more changes, resolve the thread.
     - If Gemini is uncertain or requests more work, keep the thread open and iterate.
   - If sentiment indicates Gemini daily quota exhaustion, stop Gemini follow-ups for this session and use the one-time Claude fallback review described above.
   - Never use `gh pr review` or GraphQL review comment mutations to reply (they create pending reviews).
   - Include relevant commit hashes in replies (not just titles).
   - **Do NOT wait for all threads to be resolved before proceeding to CI monitoring** - continue to step 4e and handle remaining Gemini feedback in parallel.

   4e. Wait for CI with early job failure detection:

   **Poll individual job statuses** to detect failures early instead of waiting for the entire workflow.

   Get workflow run ID:

   ```bash
   COMMIT=$(git rev-parse HEAD)
   RUN_ID=$(gh run list --commit "$COMMIT" --limit 1 --json databaseId --jq '.[0].databaseId' -R "$REPO")
   ```

   Poll job statuses (not just workflow status):

   ```bash
   gh run view $RUN_ID --json jobs --jq '[.jobs[] | {name, status, conclusion}]' -R "$REPO"
   ```

   **Job priority order** (process failures fastest-first):
   1. `build` (~15 min)
   2. `web-e2e` / `electron-e2e` (~10 min)
   3. `android-maestro-release` (~20 min)
   4. `ios-maestro-release` (~30 min)

   Poll cadence (with jitter):
   - 0-5 min: every 1 min
   - 5-15 min: every 2 min
   - 15+ min: every 3 min

   **At each poll**:

   1. Check if branch is behind: `gh pr view "$PR_NUMBER" --json mergeStateStatus -R "$REPO"`
      - If `BEHIND`, cancel the current workflow run to save CI minutes (only if `RUN_ID` is set), then return to 4c immediately:

        ```bash
        if [ -n "$RUN_ID" ]; then
          gh run cancel $RUN_ID -R "$REPO"
        fi
        ```

   2. Handle Gemini feedback (if applicable)
      - Always run Gemini evaluation/close-out on every poll iteration, even when CI jobs are still running or have failed.
      - Run `/address-gemini-feedback` to process unresolved feedback.
      - Run `/follow-up-with-gemini` immediately after to resolve threads that Gemini has confirmed as addressed.
      - Do not defer thread close-out until the workflow finishes; keep reviews moving in parallel with CI fixes.

   3. Check job statuses:
      - If job succeeded: reset `job_failure_counts[job] = 0`
      - If job failed:
        - Increment `job_failure_counts[job]`
        - If count >= 3: ask user for help
        - Else: run `/fix-tests <job-name>`, push fix, cancel workflow:
          - After pushing the fix, run Gemini evaluation/close-out again before the next poll iteration so review threads do not stall behind CI.

          ```bash
          gh run cancel $RUN_ID -R "$REPO"
          ```

   4. If all jobs succeeded → continue to 4f
      If any jobs running → continue polling

   When CI is cancelled externally: `gh run rerun $RUN_ID -R "$REPO"`

   4f. Enable auto-merge and continue looping until merged:

   If `has_bumped_version` is still `false`, perform the bump, amend, force push, and return to 4e.

   ```bash
   gh pr merge "$PR_NUMBER" --auto --merge -R "$REPO"
   gh pr view "$PR_NUMBER" --json state,mergeStateStatus,autoMergeRequest -R "$REPO"
   ```

   - Only enable auto-merge after:
     - All required status checks pass
     - Branch is up to date with `main` (not `BEHIND`)
     - Gemini feedback is fully addressed (per sentiment analysis)
   - If auto-merge is unavailable, try a direct merge (same conditions) and continue polling.

   After enabling auto-merge, do NOT exit. Continue polling in the main loop:
   - If `MERGED`: exit loop.
   - If `BEHIND`: return to 4c to rebase, push, and keep auto-merge eligible.
   - If `BLOCKED`/`UNKNOWN`: resume 4d/4e.
   - If `CLEAN`: keep auto-merge enabled and continue.

   Optimization: after 4f, poll more frequently for a short window to catch new base changes quickly:
   - First 5 minutes after enabling auto-merge: poll merge state every 30 seconds (with jitter).
   - After 5 minutes: fall back to normal polling cadence.

   Optimization: if `autoMergeRequest` is already present, skip re-enabling and proceed to the loop checks above.

5. Refresh workspace after merge:

   ```bash
   refresh.sh
   ```

   Post-merge QA handling for `associated_issue_number`:
   - Reopen the issue if closed.
   - Ensure the `needs-qa` label is applied.
   - Prefer updating the issue body with merge status.

6. Report success with PR URL, a short description of the merged changes, and the associated issue status.

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

## Token Efficiency

Suppress stdout on git commands:

```bash
git push --force-with-lease >/dev/null
git push >/dev/null
git commit -S -m "message" >/dev/null
git fetch origin <baseRefName> >/dev/null
git rebase origin/<baseRefName> >/dev/null
```

Always use minimal `--json` fields and avoid redundant fetches.
