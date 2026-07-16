---
name: ship-pr
description: Ship current work end-to-end — commit on a feature branch, cross-agent review and repair it, open or resume its PR with a single push after the review, squash-merge the exact reviewed commit, then return to the base branch and delete the merged branch
---

# Ship PR

Run the full ship flow for the current work: **commit the work on a feature
branch**, get a **cross-agent review** that repairs its own blocking findings,
**open or resume its PR**, then **squash-merge** and clean up. The PR is opened
*after* the review, so a fresh branch is pushed **once** — through the pre-push
hook once — instead of once at open time and again for each repair round.
Delegate PR creation, the review-and-repair loop, and the final merge to the
`open-pr`, `cross-agent-review`, and `squash-merge` skills. This skill owns the
ordering and the merge gate; it does not re-implement the wrapped skills.

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
- The worktree contains only changes intended for this PR. A PR may already be
  open; this is how a prior gated run resumes after fixes.

The flow may start on the default branch. In that case step 1 performs the same
safe move `open-pr` documents — preserving the intended work, fast-forwarding the
default branch, creating a feature branch, and restoring the work there — but
**commits without pushing or opening the PR**, so the review still runs before
the single push. Each wrapped skill re-checks its own preconditions.

## Setup

```bash
ROOT_DIR=$(git rev-parse --show-toplevel)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)
AGENT_TOOL="$ROOT_DIR/packages/agent-tool/src/index.ts"
[ -f "$AGENT_TOOL" ] || { echo "Error: agent-tool not found at $AGENT_TOOL" >&2; exit 1; }
[ -n "$DEFAULT_BRANCH" ] || { echo "Error: repository default branch is unavailable" >&2; exit 1; }
```

## Workflow

Run the wrapped skills in order. Stop on operational failures, an unresolved
blocking verdict, or an overridden-head mismatch. Let each wrapped skill own its
mechanics: quoting, commitlint validation, the review fallback chain and repair
loop, subject-only squash, and `MERGED`-state verification.

1. **Commit the work on a feature branch — no push, no PR yet**: reach a state
   where the intended work is committed on a feature branch and, in the fresh
   case, nothing is pushed and no PR exists — so the review reads local commits
   and the branch is pushed exactly once, when the PR is opened.

   First look up whether an open PR already exists for the branch
   (`gh pr list --head "$BRANCH" --state open`); one may remain from a prior gated
   run. Then take the matching case:

   - **A PR is already open for the branch** (a prior gated run resuming after
     fixes): do not prepare a new branch or open another PR. Confirm it targets
     the expected branch, then run the relevant preflight, stage only intended
     paths, commit any uncommitted intended work with a valid conventional
     subject, and push it without force so the pushed head carries the resumed
     work. Capture its number, URL, and title, and set `PR_NUMBER` to it. On this
     existing-PR path `cross-agent-review` reviews the pushed head and pushes its
     own repairs, and step 3 is a no-op.
   - **`$BRANCH` equals `$DEFAULT_BRANCH`**: move the work to a new feature branch
     with the same safe transition `open-pr` documents in its "Move
     default-branch work safely" step — stash tracked and untracked work, fetch,
     verify local default has not diverged, fast-forward local default, create the
     feature branch, restore the work — then run the preflight, stage only
     intended paths, and commit with a valid conventional subject. **Stop before
     pushing, and do not open a PR.** Refresh `$BRANCH` and leave `PR_NUMBER`
     empty.
   - **A feature branch with no open PR**: run the preflight, stage only intended
     paths, and commit any uncommitted intended work with a valid conventional
     subject. **Do not push.** Leave `PR_NUMBER` empty.
   - In every case, stop if unrelated changes are mixed into the worktree.

   `cross-agent-review` reads the current branch either way: with `PR_NUMBER`
   empty it reviews the local commits against the default branch; with the
   resumed PR open it reviews the pushed head.

2. **Review and repair** — invoke `cross-agent-review`, forwarding the
   review-agent argument, and `--passes <n>` / `--repair-rounds <n>` when given.

   That skill owns the review, the severity gate, and the bounded repair loop: it
   snapshots each candidate head — the pushed PR head when one is open, the local
   HEAD otherwise — reviews it, repairs blocking findings (committing locally when
   there is no PR, pushing when there is), and re-reviews every head it changes. It
   reports back a **head SHA**, a **verdict**, and the **repair rounds** it
   performed. The SHA is a reviewed head on every verdict except
   **review-could-not-run**, where it is the unreviewed candidate head — only
   reachable here via `--merge-anyway`.

   Relay its output — which agent ran, whether it fell back, the findings, and
   what was repaired.

   Take its reported head SHA as `REVIEWED_SHA` and confirm it is still the local
   HEAD — and, when a PR is already open, the pushed head too:

   ```bash
   REVIEWED_SHA=<final reviewed SHA reported by cross-agent-review>
   test "$REVIEWED_SHA" = "$(git rev-parse HEAD)"
   [ -z "$PR_NUMBER" ] || test "$REVIEWED_SHA" = "$(gh pr view "$PR_NUMBER" --json headRefOid -q .headRefOid)"
   ```

   If either differs, a commit landed after the loop finished. Discard the result,
   reconcile safely, and re-run `cross-agent-review` on the new head. Never carry a
   stale SHA into the later steps.

   **Merge gate** — decide on the reported verdict:
   - **Clean, or non-blocking nits only** — carry that exact `REVIEWED_SHA`
     forward to steps 3–4.
   - **Unresolved blocking findings** — because the repair rounds were exhausted,
     `--repair-rounds 0` was given, or the loop stopped to ask for direction —
     **stop** and report them, unless `--merge-anyway` was given. In the fresh
     path no PR was opened, so stopping here leaves nothing to clean up.
   - **Review could not run** (every agent and fallback failed) — **stop** rather
     than merge unreviewed, unless `--merge-anyway` was given. In that override
     the reported SHA is the **unreviewed candidate** head; the head checks above
     and the `--match-head-commit` bind still apply to it, so the merge is still
     pinned to a known commit — it simply is not a reviewed one. Say so.

   When `--merge-anyway` is set and the gate would otherwise stop, surface the
   blocking or unavailable findings, state plainly that the gate is being
   overridden, and proceed to steps 3–4.

   **Never repair here.** Fixing a finding in this step would produce a head that
   `cross-agent-review` never read, and `REVIEWED_SHA` would no longer describe
   the commit being merged. Raise `--repair-rounds` instead.

3. **Open the PR — the single push, bound to the reviewed head**:

   - **No PR yet** (the fresh path, `PR_NUMBER` empty): invoke `open-pr` with the
     title argument (or none), piping the body via stdin. The worktree is clean
     after the review, so `open-pr` commits nothing new; it pushes the branch
     **once** — the only push of the flow, and the one that goes through the
     pre-push hook — and opens the PR. Capture its number and URL, and set
     `PR_NUMBER`. Stop if creation fails.
   - **A PR is already open** (the resume path from step 1): it is already pushed
     with the reviewed repairs; do **not** call `open-pr`. Reuse its number, URL,
     and title.

   Then confirm the pushed PR head is exactly the reviewed head, so step 4 binds
   the merge to a commit a review actually read:

   ```bash
   test "$REVIEWED_SHA" = "$(git rev-parse HEAD)"
   test "$REVIEWED_SHA" = "$(gh pr view "$PR_NUMBER" --json headRefOid -q .headRefOid)"
   ```

   If either differs — `open-pr` committed a stray change, or the head moved —
   reconcile and re-review before merging; never merge a head the review did not
   read.

4. **Squash-merge and clean up (bound to the reviewed head)** — invoke the
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

   The empty subject falls back to the PR title captured when the PR was opened or
   resumed (step 3, or step 1 on the resume path), to which the tool appends the
   `(#<pr>)` reference; it validates the subject with commitlint and
   confirms the PR reached `MERGED` before returning. A non-zero result means the
   PR did not actually merge (queued, blocked, or the head moved off
   `REVIEWED_SHA`) — do not report success in that case; re-review the new head
   instead.

5. **Report results**: the PR URL, review agent and fallback status, repair rounds
   performed, findings fixed or waived, and the final squash subject including
   its ` (#<pr>)` reference. Note that the branch was pushed once, at open time
   (or, on the resume path, that it was already open). Confirm the merge reached
   `MERGED`, and state the branch returned to and that the merged branch was
   deleted — or, when cleanup was skipped (`--keep-branch`, a dirty worktree, a
   merge that did not land), say so and what was left behind.

## Notes

- **Order is enforced**: commit → review-and-repair → open/resume → merge →
  cleanup. A failure before the open step leaves committed local work and no PR;
  a failure after it leaves the PR in a safe, open state. Either way it is
  reported.
- **One push, after the review** — on the fresh path the branch is pushed exactly
  once, when the PR is opened, so the pre-push hook runs once rather than at open
  time and again for every repair round. Reviewing local commits before the PR
  exists is what buys this. (The resume path keeps its already-open PR and pushes
  repairs to it, as before.)
- **The review gates the merge** — this flow never silently merges over a verdict
  that reports unresolved blocking findings, and never merges an unreviewed head.
- **Repair belongs to `cross-agent-review`** — including the severity vocabulary
  (Blocker/Major ≡ [P0]/[P1] are blocking), the round budget, and the re-review of
  every changed head. This skill only reads the verdict it reports and decides
  whether to merge. `--repair-rounds` and `--passes` are forwarded, not
  interpreted.
- **The merged head is the reviewed head** — `cross-agent-review` reports a SHA it
  actually reviewed; this skill re-verifies it against the local head (and against
  the pushed head once the PR is open) and passes it to `squash-merge`, which
  binds the merge with
  `--match-head-commit`. GitHub then rejects the merge outright if any commit
  landed after the review, so an unreviewed commit can never be merged. The lone
  exception is an explicit `--merge-anyway` over a could-not-run verdict, where
  the bound head is a candidate that no review read — the merge is still pinned,
  but the reviewed-head guarantee is the thing the caller chose to waive.
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
