---
name: issue-slice-autopilot
description: Run a long-lived, multi-PR issue completion loop for complex issues by selecting the largest non-overlapping sane slice, implementing it, and then invoking $commit-and-push followed by $enter-merge-queue for each slice until the issue is complete.
---

# Issue Slice Autopilot

Drive a complex issue to completion across multiple PRs with minimal or no user intervention.

This skill is for long-running tasks where one giant PR is too risky. It repeatedly:

1. selects the largest sane slice with no overlap with in-flight work,
1. implements and validates the slice,
1. runs `$commit-and-push`,
1. runs `$enter-merge-queue` until merged,
1. refreshes state and repeats.

## Core Rules

- Keep exactly one active PR at a time.
- Always avoid overlap with open PRs touching the same area.
- Prefer the largest independent slice that has clear done criteria.
- Do not leave a slice half-shipped; either finish it or skip it for now.
- After each merged PR, re-evaluate the issue from current `main`.
- Stop only when issue completion criteria are met, or progress is blocked.

## State (Required)

Persist state in git-ignored workspace state so the loop can resume after refreshes/restarts:

```bash
ISSUE_NUMBER="<issue-number>"
STATE_DIR=".git/issue-slice-autopilot"
STATE_FILE="$STATE_DIR/issue-${ISSUE_NUMBER}.json"
mkdir -p "$STATE_DIR"
```

State shape:

```json
{
  "issue_number": 2540,
  "repo": "owner/repo",
  "iteration": 0,
  "completed_slices": [],
  "skipped_slices": [],
  "active_pr": null,
  "last_merged_pr": null,
  "blocked_reason": null,
  "updated_at": "<iso>"
}
```

Update this file at the end of each major phase.

## Phase 1: Issue Recon

1. Resolve repo and load issue:

```bash
REPO=$(./scripts/agents/tooling/agentTool.ts getRepo)
gh issue view "$ISSUE_NUMBER" -R "$REPO" --json number,title,body,state,url
```

1. Build non-overlap context from open PRs:

```bash
gh pr list -R "$REPO" --state open --json number,title,headRefName
```

For each open PR, collect changed files:

```bash
gh pr view <pr> -R "$REPO" --json files --jq '.files[].path'
```

1. Collect prior merged work linked to the issue (for dedupe):

```bash
gh pr list -R "$REPO" --state merged --search "#${ISSUE_NUMBER} in:body" --json number,title,mergedAt
```

1. Convert issue requirements into a slice backlog. Each slice needs:

- `name`
- `scope`
- `candidate_files`
- `done_criteria`
- `validation_commands`
- `risk_level`
- `estimated_size`

## Phase 2: Slice Selection

Score candidates by:

```text
score = size + independence + impact - overlap_risk - migration_risk
```

Selection rules:

1. Exclude slices whose `candidate_files` overlap with any open PR files.
1. Exclude slices with unclear done criteria.
1. Prefer slices that:

- remove legacy paths/endpoints,
- remove proxy layers,
- remove obsolete dependencies,
- unlock later deletions.

1. Pick the highest scoring remaining slice.

If no non-overlapping slice exists, set `blocked_reason` and stop.

## Phase 3: Implement Slice

1. Ensure clean base:

```bash
git checkout main >/dev/null
git pull --ff-only >/dev/null
```

1. Create implementation branch for this slice.
1. Implement fully with tests.
1. Run focused validation first, then broader required checks.

If coverage or quality gates fail, add tests before commit. Do not lower thresholds.

## Phase 4: Ship Slice

After implementation is complete and local validation passes:

1. Invoke `$commit-and-push`.
1. Invoke `$enter-merge-queue`.
1. Wait for merge completion (handled by `$enter-merge-queue`).

Do not start the next slice until merge is confirmed.

## Phase 5: Post-Merge Update

1. Refresh workspace (normally handled by `$enter-merge-queue`).
1. Confirm current branch is `main` and clean.
1. Append merged PR metadata to `completed_slices`.
1. Increment `iteration`.
1. Re-run Phase 1 recon against latest code.

Repeat Phases 2-5 until done.

## Completion Conditions

Mark complete when all are true:

- Issue checklist items are satisfied in code.
- No remaining runtime references to removed legacy paths/proxy helpers (except explicitly allowed exceptions).
- Required builds/tests pass for touched packages.
- No additional non-overlapping high-value slice remains.

## Blocked Conditions

Stop and report when any occurs:

- No non-overlapping slices remain while open PRs are still active.
- A required slice repeatedly fails CI 3 times after fixes.
- Merge conflicts require ambiguous tradeoffs and cannot be resolved safely.
- The issue requires user product decisions that cannot be inferred.

## Anti-Patterns (Never)

- Do not bundle unrelated cleanup into one slice.
- Do not open multiple active PRs for one issue in parallel.
- Do not reply to review threads referencing unpushed commits.
- Do not skip validation gates to keep momentum.
- Do not use auto-close keywords in PR bodies.

## Recommended Loop Skeleton

```text
LOAD/INIT STATE
RECON ISSUE + PR OVERLAP
WHILE NOT COMPLETE:
  SELECT LARGEST NON-OVERLAPPING SLICE
  IMPLEMENT + TEST
  RUN $commit-and-push
  RUN $enter-merge-queue
  REFRESH + UPDATE STATE
FINAL ISSUE COMPLETION REPORT
```

## Issue #2540 Mapping Heuristic

For #2540-like migrations, prefer this order:

1. Remaining deproxy service slices with strongest boundaries.
1. Legacy routing/unmount deletion once deproxy dependencies are removed.
1. Client wrapper/type migration cleanup.
1. Final dependency removals and dead-code deletion.

Always re-check overlap against currently open PRs before each slice.

## Output Contract Per Iteration

For each slice, report:

- selected slice name and rationale,
- overlap check result,
- PR number/URL,
- merge result,
- remaining backlog.

At final completion, report:

- all merged PRs in order,
- what issue requirements were completed in each,
- any intentionally deferred follow-ups.
