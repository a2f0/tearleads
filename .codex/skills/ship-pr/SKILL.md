---
name: ship-pr
description: Ship the current branch end-to-end — open a PR, run a cross-agent review, then squash-merge, in that order, wrapping the open-pr, cross-agent-review, and squash-merge skills
---

# Ship PR

Run the full ship flow for the current branch in one pass: **open a PR**, get a
**cross-agent review**, then **squash-merge** — delegating to the `open-pr`,
`cross-agent-review`, and `squash-merge` skills, in that order. This skill owns
only the orchestration: preconditions, ordering, stop-on-failure, and a review
gate on the merge. It does **not** re-implement the wrapped skills — it invokes
each one and lets it enforce its own rules.

The review gates the merge: this flow does not squash-merge over a review that
raised blocking issues, and it merges only the exact commit that was reviewed.

## Arguments

- First argument (optional): the conventional-commit title (`type(scope): …`,
  ≤50 chars), single-quoted. It is used as the PR title **and**, because the
  squash subject defaults to the PR title, as the squash commit subject. When
  omitted it defaults to the branch's latest commit subject. **To supply a later
  positional argument while defaulting the title, pass an empty string `''` as
  the first argument** rather than dropping it — an empty title falls back to the
  latest commit subject (and, downstream, the PR title).
- Second argument (optional): the review agent to pass to `cross-agent-review`
  (`claude` or `codex`). When omitted, that skill picks its own default — the
  *other* agent from whichever one is running this flow.
- `--passes <n>` (optional flag, position-independent): forwarded verbatim to
  `cross-agent-review`. **Defaults to `1`** — a single review pass. This flow
  never re-reviews on its own (see the no-auto-loop note below).
- `--merge-anyway` (optional flag, position-independent): override the review
  gate. By default the flow stops when the review raises blocking findings or
  cannot run at all (step 2); with this flag it surfaces exactly what it is
  overriding and then proceeds. The reviewed-head guard still applies, so even an
  overridden review merges only the reviewed commit.
- The PR body is read from stdin (empty when none is piped) and passed to
  `open-pr`.

## Prerequisites

- `git` and `gh` (authenticated) on `PATH`.
- The `@tearleads/agent-tool` package: `packages/agent-tool/src/index.ts`.
- `node_modules` installed (`bun install`) so the commitlint CLI is available.
- The current branch is a **feature branch** (not the default branch), **pushed
  to the remote**, with commits ahead of the base and **no open PR yet**.

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

Run the three skills **in order**, stopping at the first failure. Invoke each
skill rather than re-implementing it, so the wrapped skill owns its mechanics
(single-quoting, commitlint validation, the review fallback chain, the
subject-only squash with its `(#<pr>)` reference, and the `MERGED`-state check).

1. **Open the PR** — invoke the `open-pr` skill with the title argument (or none,
   to default to the latest commit subject), piping the body via stdin. If it
   fails (invalid title, branch not pushed, or a PR already exists for the
   branch), **stop and report** — there is nothing to review or merge. On
   success, capture the PR number as `PR_NUMBER` and the URL.

2. **Cross-agent review** — first **snapshot the commit that will be reviewed**,
   before invoking the reviewer, and confirm it is the pushed PR head (the review
   helpers diff the local `HEAD`, so the reviewed commit must be what would
   merge):

   ```bash
   REVIEWED_SHA=$(git rev-parse HEAD)
   test "$REVIEWED_SHA" = "$(gh pr view "$PR_NUMBER" --json headRefOid -q .headRefOid)"
   ```

   (If local and remote heads differ, push first so the reviewed commit is the
   one that would merge.) Then invoke the `cross-agent-review` skill, passing the
   review-agent argument and `--passes <n>` when given — it runs a **single pass**
   by default. Relay its findings, including which agent ran and whether it fell
   back.

   After the review returns, confirm the branch did not move while it ran:

   ```bash
   test "$REVIEWED_SHA" = "$(git rev-parse HEAD)"
   ```

   If it changed, a commit landed mid-review — re-snapshot and re-review before
   continuing. Carry `REVIEWED_SHA` into step 3.

   **Review gate** — read the findings and decide before merging. Reviewers use
   different severity vocabularies: the in-session fallback uses **Blocker /
   Major / Minor / Suggestion**, while Codex's native `codex review` uses
   **[P0]–[P3]**. Treat them as one scale — **Blocker ≡ [P0]**, **Major ≡ [P1]**,
   **Minor ≡ [P2]**, **Suggestion ≡ [P3]** — where **Blocker/Major (P0/P1) count
   as blocking**:
   - If the review raises a **blocking** finding (**Blocker/Major** or
     **[P0]/[P1]**), **stop before step 3** and surface it so it can be fixed
     first. Do not squash-merge over unresolved blocking findings unless
     `--merge-anyway` was given.
   - If the review is clean or raises only non-blocking nits (**Minor/Suggestion**
     or **[P2]/[P3]**), proceed.
   - If the review could not run at all (every agent and fallback failed),
     **stop** rather than merge unreviewed unless `--merge-anyway` was given.

   When `--merge-anyway` is set and the gate would otherwise stop, surface the
   blocking or unavailable findings, state plainly that the gate is being
   overridden, and proceed to step 3.

   **No auto-loop.** With the default single pass, this flow does not fix and
   re-review on its own. When the gate stops it, report the findings and hand
   back. Fixing them moves the head, which makes the completed review stale, and
   spending another review pass on the new head is the caller's call — re-running
   `ship-pr` afterwards is a deliberate fresh run. Chaining fix → re-review
   automatically runs away, chasing ever-narrower findings and never converging.

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

4. **Report results**: the PR URL, the review agent and outcome (plus any
   findings that gated the merge or were waived), and the final squash subject
   including its ` (#<pr>)` reference, confirming the merge succeeded.

## Notes

- **Order is enforced**: open → review → merge. A failure in an earlier step
  prevents the later ones; the PR is left in a safe intermediate state (e.g. open
  but unmerged) and reported.
- **The review gates the merge** — this flow never silently merges over a review
  that found blocking issues, across either severity vocabulary (Blocker/Major or
  [P0]/[P1]).
- **One review pass, no auto-loop** — the flow reviews once (pass `--passes <n>`
  to opt into more), gates, and stops. It never chains fix → re-review → fix on
  its own; each additional review is a deliberate re-run.
- **The merged head is the reviewed head** — `REVIEWED_SHA` is snapshotted
  *before* the review, verified unchanged *after* it, and passed to
  `squash-merge`, which binds the merge with `--match-head-commit`. GitHub then
  rejects the merge outright if any commit landed after the review, so an
  unreviewed commit can never be merged.
- **Title and subject stay in sync automatically**: `squash-merge` defaults to
  the PR title that `open-pr` set, so a single title argument (or none) suffices
  for both.
- **Thin wrapper**: each wrapped skill still enforces its own rules, so this
  skill adds no new validation — it only sequences and gates.
- Single-quote the title argument and use a quoted heredoc for the body (per
  `open-pr`) so the shell does not expand `$(...)`, backticks, or `$VAR`.
