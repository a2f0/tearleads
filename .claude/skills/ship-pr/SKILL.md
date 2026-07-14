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
raised blocking issues, and it only merges the exact commit that was reviewed.

## Arguments

- First argument (optional): the conventional-commit title (`type(scope): …`,
  ≤50 chars). It is used as the PR title **and**, because the squash subject
  defaults to the PR title, as the squash commit subject. When omitted, `open-pr`
  falls back to the branch's latest commit subject and `squash-merge` falls back
  to the PR title, so the two stay in sync either way. Pass it single-quoted.
- Second argument (optional): the review agent to pass to `cross-agent-review`
  (`claude` or `codex`). When omitted, that skill picks its own default — the
  *other* agent from whichever one is running this flow.
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

2. **Cross-agent review** — invoke the `cross-agent-review` skill, passing the
   review-agent argument when given. Relay its findings, including which agent
   ran and whether it fell back.

   **Pin the reviewed head** — the review helpers inspect the local `HEAD` diff,
   so record the exact commit that was reviewed and confirm it is the pushed PR
   head:

   ```bash
   REVIEWED_SHA=$(git rev-parse HEAD)
   test "$REVIEWED_SHA" = "$(gh pr view "$PR_NUMBER" --json headRefOid -q .headRefOid)"
   ```

   Carry `REVIEWED_SHA` into step 3. (If the local and remote heads differ, push
   first so the reviewed commit is the one that would merge.)

   **Review gate** — read the findings and decide before merging. Reviewers use
   different severity vocabularies: the in-session fallback uses **Blocker /
   Major / Minor / Suggestion**, while Codex's native `codex review` uses
   **[P0]–[P3]**. Treat them as one scale — **Blocker ≡ [P0]**, **Major ≡ [P1]**,
   **Minor ≡ [P2]**, **Suggestion ≡ [P3]** — where **Blocker/Major (P0/P1) count
   as blocking**:
   - If the review raises a **blocking** finding (**Blocker/Major** or
     **[P0]/[P1]**), **stop before step 3** and surface it so it can be fixed
     first. Do not squash-merge over unresolved blocking findings.
   - If the review is clean or raises only non-blocking nits (**Minor/Suggestion**
     or **[P2]/[P3]**), proceed.
   - If the review could not run at all (every agent and fallback failed),
     **stop** rather than merge unreviewed — unless the user explicitly asked to
     merge regardless.

3. **Squash-merge** — first confirm the branch has not moved since the review, so
   only the reviewed commit merges:

   ```bash
   test "$(gh pr view "$PR_NUMBER" --json headRefOid -q .headRefOid)" = "$REVIEWED_SHA"
   ```

   If the head changed (a commit landed after the review), **do not merge** —
   return to step 2 and re-review the new head. Otherwise invoke the
   `squash-merge` skill. With no subject argument it defaults to the PR title
   from step 1 and appends the `(#<pr>)` reference; it validates the subject with
   commitlint and confirms the PR reached `MERGED` before returning. A non-zero
   result means the PR did not actually merge (e.g. queued or blocked) — do not
   report success in that case.

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
- **The merged head is the reviewed head** — the reviewed PR head SHA is pinned
  in step 2 and re-checked in step 3, so a commit pushed after the review forces
  a re-review instead of merging unreviewed.
- **Title and subject stay in sync automatically**: `squash-merge` defaults to
  the PR title that `open-pr` set, so a single title argument (or none) suffices
  for both.
- **Thin wrapper**: each wrapped skill still enforces its own rules, so this
  skill adds no new validation — it only sequences and gates.
- Single-quote the title argument and use a quoted heredoc for the body (per
  `open-pr`) so the shell does not expand `$(...)`, backticks, or `$VAR`.
