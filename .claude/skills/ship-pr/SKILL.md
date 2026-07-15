---
name: ship-pr
description: Ship the current branch end-to-end — open or resume a PR, cross-agent review and repair it, squash-merge the exact reviewed commit, then return to the base branch and delete the merged branch
---

# Ship PR

Run the full ship flow for the current branch: **open or resume a PR**, get a
**cross-agent review** that repairs its own blocking findings, then
**squash-merge** and clean up. Delegate PR creation, the review-and-repair loop,
and the final merge to the `open-pr`, `cross-agent-review`, and `squash-merge`
skills. This skill owns the ordering and the merge gate; it does not re-implement
the wrapped skills.

The review gates the merge. `cross-agent-review` addresses actionable blocking
findings and re-reviews every head it changes, then reports the final reviewed
SHA and verdict. This skill merges that exact SHA, and only on a non-blocking
verdict. Never merge a commit that was not itself reviewed.

A successful flow ends back on the PR's base branch — the default branch for a PR
`open-pr` created — fast-forwarded, with the merged branch deleted. That cleanup
belongs to `squash-merge`, which runs it only after GitHub confirms the PR is
`MERGED` and that the base branch actually contains the merge commit.

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
  `cross-agent-review`. **Defaults to `1`** there. Passes inspect one unchanged
  head; they are distinct from repair rounds.
- `--repair-rounds <n>` (optional flag, position-independent): forwarded verbatim
  to `cross-agent-review`, which owns the repair loop and bounds it. **Defaults
  to `2`** there. Use `0` to retain stop-and-report behavior — the review runs and
  reports, and this flow stops on any blocking finding.
- `--merge-anyway` (optional flag, position-independent): override the merge gate.
  By default the flow stops when `cross-agent-review` reports unresolved blocking
  findings or could not review at all; with this flag it surfaces exactly what it
  is overriding and proceeds. The reviewed-head guard still applies.
- `--keep-branch` (optional flag, position-independent): forwarded verbatim to
  `squash-merge`, which then skips the post-merge cleanup and stays on the
  feature branch. Use when the branch is still needed locally.
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

Run the wrapped skills in order. Stop on operational failures, an unresolved
blocking verdict, or an overridden-head mismatch. Let each wrapped skill own its
mechanics: quoting, commitlint validation, the review fallback chain and repair
loop, subject-only squash, and `MERGED`-state verification.

1. **Open or resume the PR** — look up an open PR for the current branch.

   - If none exists, invoke `open-pr` with the title argument (or none), piping
     the body via stdin. Capture its PR number and URL. Stop if creation fails.
   - If one exists, reuse its number, URL, and title instead of invoking
     `open-pr`. Confirm it targets the expected branch. If intended changes are
     already present locally, run the relevant preflight, stage only those paths,
     commit with a valid conventional subject, and push without force. Stop if
     unrelated changes are mixed into the worktree.
   - `cross-agent-review` asserts that local `HEAD` equals the pushed PR head
     before it reviews, so anything committed here must be pushed first.

2. **Review and repair** — invoke `cross-agent-review`, forwarding the
   review-agent argument, and `--passes <n>` / `--repair-rounds <n>` when given.

   That skill owns the review, the severity gate, and the bounded repair loop: it
   snapshots each candidate head, asserts it is the pushed PR head, reviews it,
   repairs blocking findings, and re-reviews every head it changes. It reports
   back a **final reviewed SHA**, a **verdict**, and the **repair rounds** it
   performed.

   Relay its output — which agent ran, whether it fell back, the findings, and
   what was repaired.

   Take its reported final SHA as `REVIEWED_SHA` and confirm it is still both the
   local and the pushed head:

   ```bash
   REVIEWED_SHA=<final reviewed SHA reported by cross-agent-review>
   test "$REVIEWED_SHA" = "$(git rev-parse HEAD)"
   test "$REVIEWED_SHA" = "$(gh pr view "$PR_NUMBER" --json headRefOid -q .headRefOid)"
   ```

   If either differs, a commit landed after the loop finished. Discard the result,
   reconcile safely, and re-run `cross-agent-review` on the new pushed head. Never
   carry a stale SHA into the merge step.

   **Merge gate** — decide on the reported verdict:
   - **Clean, or non-blocking nits only** — carry that exact `REVIEWED_SHA` into
     step 3.
   - **Unresolved blocking findings** — because the repair rounds were exhausted,
     `--repair-rounds 0` was given, or the loop stopped to ask for direction —
     **stop** and report them, unless `--merge-anyway` was given.
   - **Review could not run** (every agent and fallback failed) — **stop** rather
     than merge unreviewed, unless `--merge-anyway` was given.

   When `--merge-anyway` is set and the gate would otherwise stop, surface the
   blocking or unavailable findings, state plainly that the gate is being
   overridden, and proceed to step 3.

   **Never repair here.** Fixing a finding in this step would produce a head that
   `cross-agent-review` never read, and `REVIEWED_SHA` would no longer describe
   the commit being merged. Raise `--repair-rounds` instead.

3. **Squash-merge and clean up (bound to the reviewed head)** — invoke the
   `squash-merge` skill, passing `REVIEWED_SHA` as its **second (head-SHA)
   argument** so the merge runs with `--match-head-commit` and GitHub
   **atomically** refuses to merge anything but the reviewed commit. This closes
   the window between the gate decision and the merge — the guard is enforced by
   GitHub at merge time, not by a racy preflight check.

   That skill also owns the post-merge cleanup: once GitHub confirms `MERGED`, it
   returns to the PR's base branch, fast-forwards it, verifies it contains the
   merge commit, and deletes the merged branch locally and remotely. Forward
   `--keep-branch` when it was given to opt out. Do not re-implement the cleanup
   here; it is gated on the merge actually landing, so it must stay with the step
   that performs the merge.

   **Invoke the `squash-merge` skill — do not call the tool directly from here.**
   The tool merges and returns; the cleanup and `--keep-branch` live in the skill
   *around* that call, and the tool knows neither. Reaching past the skill to
   `bun "$AGENT_TOOL" squashMerge …` merges the PR and silently skips the cleanup,
   leaving the feature branch checked out and undeleted.

   Because the head SHA is the **second** positional argument, pass an empty
   first argument to default the subject to the PR title — the skill takes the
   same arguments this flow forwards:

   ```text
   squash-merge '' "$REVIEWED_SHA"            # subject defaults to the PR title
   squash-merge '' "$REVIEWED_SHA" --keep-branch   # only when the caller gave it
   ```

   The empty subject falls back to the PR title from step 1, to which the tool
   appends the `(#<pr>)` reference; it validates the subject with commitlint and
   confirms the PR reached `MERGED` before returning. A non-zero result means the
   PR did not actually merge (queued, blocked, or the head moved off
   `REVIEWED_SHA`) — do not report success in that case; re-review the new head
   instead.

4. **Report results**: the PR URL, review agent and fallback status, repair rounds
   performed, findings fixed or waived, and the final squash subject including
   its ` (#<pr>)` reference. Confirm the merge reached `MERGED`, and state the
   branch returned to and that the merged branch was deleted — or, when cleanup
   was skipped (`--keep-branch`, a dirty worktree, a merge that did not land),
   say so and what was left behind.

## Notes

- **Order is enforced**: open/resume → review-and-repair → merge → cleanup. A
  failure leaves the PR in a safe, open state and is reported.
- **The review gates the merge** — this flow never silently merges over a verdict
  that reports unresolved blocking findings, and never merges an unreviewed head.
- **Repair belongs to `cross-agent-review`** — including the severity vocabulary
  (Blocker/Major ≡ [P0]/[P1] are blocking), the round budget, and the re-review of
  every changed head. This skill only reads the verdict it reports and decides
  whether to merge. `--repair-rounds` and `--passes` are forwarded, not
  interpreted.
- **The merged head is the reviewed head** — `cross-agent-review` reports a SHA it
  actually reviewed; this skill re-verifies it against the local and pushed heads
  and passes it to `squash-merge`, which binds the merge with
  `--match-head-commit`. GitHub then rejects the merge outright if any commit
  landed after the review, so an unreviewed commit can never be merged.
- **Title and subject stay in sync automatically**: `squash-merge` defaults to
  the PR title that `open-pr` set, so a single title argument (or none) suffices
  for both.
- **Wrapped mechanics stay authoritative**: this skill coordinates, while
  `open-pr`, `cross-agent-review`, and `squash-merge` retain ownership of their
  validation and external operations — including the post-merge cleanup, which
  lives in `squash-merge` because it must be gated on the merge landing.
- **Cleanup never runs on an unmerged branch** — it is gated on GitHub reporting
  `MERGED` *and* on the base branch verifiably containing the merge commit, and it
  is skipped on a dirty worktree so in-progress work is never carried onto the
  base branch or stranded. In every case the branch survives and the reason is
  reported.
- **Invoke the wrapped skills, not the tools they call.** `squash-merge` is the
  clearest case: its cleanup and `--keep-branch` wrap the tool call rather than
  living inside the tool, so calling `squashMerge` directly still merges — it just
  skips the cleanup, and does so silently. The same holds for the review fallback
  chain and repair loop in `cross-agent-review`.
- Single-quote the title argument and use a quoted heredoc for the body (per
  `open-pr`) so the shell does not expand `$(...)`, backticks, or `$VAR`.
