---
name: ship-pr
description: Ship the current branch end-to-end — open or resume a PR, cross-agent review it, repair blocking findings in bounded rounds, re-review each changed head, then squash-merge the exact reviewed commit
---

# Ship PR

Run the full ship flow for the current branch: **open or resume a PR**, get a
**cross-agent review**, repair blocking findings in bounded rounds, then
**squash-merge**. Delegate PR creation, each review, and the final merge to the
`open-pr`, `cross-agent-review`, and `squash-merge` skills. This skill owns the
orchestration, repair loop, ordering, and merge gate; it does not re-implement
the wrapped skills.

The review gates the merge. By default, address actionable blocking findings,
push the fixes, and review the new head before merging. Never merge a commit
that was not itself reviewed.

## Arguments

- First argument (optional): the conventional-commit title (`type(scope): …`,
  ≤50 chars), single-quoted. For a new PR, it is the PR title and default squash
  subject. For an existing PR, retain that PR's title. When omitted for a new
  PR, default to the branch's latest commit subject. **To supply a later
  positional argument while defaulting the title, pass an empty string `''`.**
- Second argument (optional): the review agent to pass to `cross-agent-review`
  (`claude` or `codex`). When omitted, that skill picks its own default — the
  *other* agent from whichever one is running this flow.
- `--passes <n>` (optional flag, position-independent): forwarded verbatim to
  each `cross-agent-review` invocation. **Defaults to `1`**. Passes inspect the
  same head; they are distinct from repair rounds.
- `--repair-rounds <n>` (optional flag, position-independent): maximum blocking-
  finding repair rounds. **Defaults to `2`**. Each round may change the branch
  once and therefore requires a fresh review of the new head. Use `0` to retain
  stop-and-report behavior.
- `--merge-anyway` (optional flag, position-independent): override the review
  gate instead of repairing. By default the flow repairs blocking findings up
  to the configured limit and stops if they remain or review cannot run; with
  this flag it surfaces exactly what it is overriding and proceeds. The
  reviewed-head guard still applies.
- The PR body is read from stdin (empty when none is piped) and passed to
  `open-pr`.

## Prerequisites

- `git` and `gh` (authenticated) on `PATH`.
- The `@tearleads/agent-tool` package: `packages/agent-tool/src/index.ts`.
- `node_modules` installed (`bun install`) so the commitlint CLI is available.
- The current branch is a **feature branch** (not the default branch).
- The worktree contains only changes intended for this PR. A PR may already be
  open; this is how a prior gated run resumes after fixes.

Each wrapped skill re-checks its own preconditions; this skill only fails fast up
front when the branch is the default branch or the tool is missing.

## Setup

```bash
ROOT_DIR=$(git rev-parse --show-toplevel)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
AGENT_TOOL="$ROOT_DIR/packages/agent-tool/src/index.ts"
[ -f "$AGENT_TOOL" ] || { echo "Error: agent-tool not found at $AGENT_TOOL" >&2; exit 1; }
```

If `$BRANCH` is the repository's default branch (e.g. `main` or `master`),
report the error and stop.

## Workflow

Run the wrapped skills in order. Stop on operational failures, unsafe or
ambiguous repairs, exhausted repair rounds, or an overridden-head mismatch.
Let each wrapped skill own its mechanics: quoting, commitlint validation, the
review fallback chain, subject-only squash, and `MERGED`-state verification.

1. **Open or resume the PR** — look up an open PR for the current branch.

   - If none exists, invoke `open-pr` with the title argument (or none), piping
     the body via stdin. Capture its PR number and URL. Stop if creation fails.
   - If one exists, reuse its number, URL, and title instead of invoking
     `open-pr`. Confirm it targets the expected branch. If intended repair
     changes are already present locally, run the relevant preflight, stage only
     those paths, commit with a valid conventional subject, and push without
     force. Stop if unrelated changes are mixed into the worktree.
   - Before review, require local `HEAD` to equal the pushed PR head.

2. **Review and bounded repair loop** — set `REPAIR_ROUND=0`. For each candidate
   head, first snapshot the commit and confirm it is the pushed PR head:

   ```bash
   REVIEWED_SHA=$(git rev-parse HEAD)
   test "$REVIEWED_SHA" = "$(gh pr view "$PR_NUMBER" --json headRefOid -q .headRefOid)"
   ```

   Then invoke `cross-agent-review`, passing the review-agent argument and
   `--passes <n>` when given. Relay its findings, including which agent ran and
   whether it fell back.

   After review, confirm both local and pushed heads are still the snapshot:

   ```bash
   test "$REVIEWED_SHA" = "$(git rev-parse HEAD)"
   test "$REVIEWED_SHA" = "$(gh pr view "$PR_NUMBER" --json headRefOid -q .headRefOid)"
   ```

   If either changed, discard the stale result, reconcile safely, and review the
   new pushed head. Never carry a stale SHA into the merge step.

   **Review gate** — read the findings and decide before merging. Reviewers use
   different severity vocabularies: the in-session fallback uses **Blocker /
   Major / Minor / Suggestion**, while Codex's native `codex review` uses
   **[P0]–[P3]**. Treat them as one scale — **Blocker ≡ [P0]**, **Major ≡ [P1]**,
   **Minor ≡ [P2]**, **Suggestion ≡ [P3]** — where **Blocker/Major (P0/P1) count
   as blocking**:
   - If the review raises a **blocking** finding (**Blocker/Major** or
     **[P0]/[P1]**), surface it. With `--merge-anyway`, state that repair is
     being skipped and carry the current reviewed SHA into step 3. Otherwise,
     repair it by default. If `REPAIR_ROUND` has reached `--repair-rounds`, stop
     and report the unresolved findings. Otherwise:
     1. Confirm each fix is actionable, in scope, and requires no new authority
        or material user choice. Stop and ask for direction when that is false.
     2. Implement all blocking fixes. Also address directly adjacent
        non-blocking findings when doing so is low-risk and avoids dead code or
        vacuous tests; do not expand the PR into unrelated cleanup.
     3. Run validation proportionate to the changes, including the repository's
        staged source-shape check before committing.
     4. Stage only the repair paths, commit with a valid conventional subject,
        and push without force.
     5. Increment `REPAIR_ROUND`, snapshot the new pushed head, and repeat step 2
        so the complete PR diff is reviewed again.
   - If the review is clean or raises only non-blocking nits (**Minor/Suggestion**
     or **[P2]/[P3]**), carry that exact `REVIEWED_SHA` into step 3.
   - If the review could not run at all (every agent and fallback failed),
     **stop** rather than merge unreviewed unless `--merge-anyway` was given.

   When `--merge-anyway` is set and the gate would otherwise stop, surface the
   blocking or unavailable findings, state plainly that the gate is being
   overridden, and proceed to step 3.

   **Bounded repairs only.** `--passes` controls discovery depth on one unchanged
   head; `--repair-rounds` bounds how many times this skill may change and
   re-review the branch. Never fix after the final accepted review, and never
   merge a repaired head using an earlier review.

3. **Squash-merge (bound to the reviewed head)** — invoke the `squash-merge`
   skill, passing `REVIEWED_SHA` as its **second (head-SHA) argument** so the
   merge runs with `--match-head-commit` and GitHub **atomically** refuses to
   merge anything but the reviewed commit. This closes the window between the gate
   decision and the merge — the guard is enforced by GitHub at merge time, not by
   a racy preflight check.

   Because the head SHA is the **second** positional argument, pass an empty
   first argument to default the subject to the PR title:

   ```bash
   bun "$AGENT_TOOL" squashMerge '' "$REVIEWED_SHA"
   ```

   The empty subject falls back to the PR title from step 1, to which the tool
   appends the `(#<pr>)` reference; it validates the subject with commitlint and
   confirms the PR reached `MERGED` before returning. A non-zero result means the
   PR did not actually merge (queued, blocked, or the head moved off
   `REVIEWED_SHA`) — do not report success in that case; re-review the new head
   instead.

4. **Report results**: the PR URL, review agent and fallback status, repair rounds
   performed, findings fixed or waived, and the final squash subject including
   its ` (#<pr>)` reference. Confirm the merge reached `MERGED`.

## Notes

- **Order is enforced**: open/resume → review → bounded fix/re-review →
  merge. A failure leaves the PR in a safe, open state and is reported.
- **The review gates the merge** — this flow never silently merges over a review
  that found blocking issues, across either severity vocabulary (Blocker/Major or
  [P0]/[P1]).
- **Repairs are bounded** — default to at most two branch-changing repair rounds.
  Every changed head receives a fresh review; `--repair-rounds 0` disables
  automatic repair.
- **The merged head is the reviewed head** — `REVIEWED_SHA` is snapshotted
  *before* the review, verified unchanged *after* it, and passed to
  `squash-merge`, which binds the merge with `--match-head-commit`. GitHub then
  rejects the merge outright if any commit landed after the review, so an
  unreviewed commit can never be merged.
- **Title and subject stay in sync automatically**: `squash-merge` defaults to
  the PR title that `open-pr` set, so a single title argument (or none) suffices
  for both.
- **Wrapped mechanics stay authoritative**: this skill coordinates remediation,
  while `open-pr`, `cross-agent-review`, and `squash-merge` retain ownership of
  their validation and external operations.
- Single-quote the title argument and use a quoted heredoc for the body (per
  `open-pr`) so the shell does not expand `$(...)`, backticks, or `$VAR`.
