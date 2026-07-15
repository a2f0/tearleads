---
name: squash-merge
description: Squash-merge the current PR with a subject-only commit message validated against the repo's commitlint rules, then return to the default branch, fast-forward it, and delete the merged branch
---

# Squash Merge

Squash-merge the open PR for the current branch with a **subject-only** commit
message — no auto-generated body, commit list, or extended message. The subject
is validated against the repository's own commitlint configuration before the
merge runs, and the tool appends the PR reference `(#<pr>)` so the squash
commit ends with it — the same reference GitHub adds for web/default merges but
that `gh pr merge --subject` otherwise suppresses.

Once the PR is confirmed `MERGED`, return to the default branch, fast-forward it,
and delete the merged branch, so a shipped PR leaves no local leftovers.

## Arguments

- First argument (optional): the squash commit subject. When omitted, the PR
  title is used. Pass it as a single quoted argument, e.g.
  `"feat(app): add widget"`.
- Second argument (optional): the expected PR head SHA. When given, the merge
  adds `--match-head-commit <sha>` so GitHub **atomically refuses** the merge if
  the PR head has moved off that commit. `ship-pr` uses this to guarantee only
  the reviewed commit is merged.
- `--keep-branch` (optional flag, position-independent): skip the post-merge
  cleanup and stay on the feature branch. Use when the branch is still needed
  locally (e.g. to build a follow-up PR on top of it).

## Prerequisites

- `git` and `gh` (authenticated) on `PATH`.
- The `@tearleads/agent-tool` package: `packages/agent-tool/src/index.ts`.
- `node_modules` installed (`bun install`) so the commitlint CLI is available.
- An open, mergeable PR on the current branch.

## Setup

Resolve the PR number **before** merging — afterwards the PR is no longer open,
so `gh pr list --state open` will not find it:

```bash
ROOT_DIR=$(git rev-parse --show-toplevel)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)
PR_NUMBER=$(gh pr list --head "$BRANCH" --state open --json number --jq '.[0].number')
AGENT_TOOL="$ROOT_DIR/packages/agent-tool/src/index.ts"
[ -f "$AGENT_TOOL" ] || { echo "Error: agent-tool not found at $AGENT_TOOL" >&2; exit 1; }
[ -n "$PR_NUMBER" ] || { echo "Error: no open PR for branch $BRANCH" >&2; exit 1; }
```

If `$BRANCH` is `$DEFAULT_BRANCH`, report the error and stop.

## Workflow

1. **Determine the subject**: If the user supplied a subject, use it verbatim.
   Otherwise the tool falls back to the PR title. Do not compose a body or
   extended message — the squash commit is the subject line only. Do not append
   the `(#<pr>)` reference by hand; the tool adds it (see below).

2. **Run the squash merge**:

   ```bash
   bun "$AGENT_TOOL" squashMerge 'feat(app): add widget'
   # or, to default to the PR title:
   bun "$AGENT_TOOL" squashMerge
   # or, bind the merge to a specific reviewed head commit:
   bun "$AGENT_TOOL" squashMerge 'feat(app): add widget' "$REVIEWED_SHA"
   ```

   **Quote the subject in single quotes** so the shell does not expand
   `$(...)`, backticks, or `$VAR` before the tool sees it — the subject must
   reach `commitlint`/`gh` only as a literal argv value. If the subject itself
   contains a single quote, escape it (`'\''`) or omit the argument to use the
   PR title.

   The tool:
   - Resolves the open PR for the current branch.
   - Rejects a subject that spans multiple lines (upholds the subject-only
     guarantee).
   - Validates the subject — with any trailing `(#<n>)` stripped first — using
     the repo's commitlint setup (the same `@commitlint/cli` binary and
     `commitlint.config.mts` the commit-msg hook uses). Conventional-commit
     syntax and the 50-character header limit are enforced on the human-authored
     subject; the appended PR reference is excluded from that limit, exactly as
     GitHub's server-side suffix is. If validation fails it prints commitlint's
     report and exits non-zero **without merging**.
   - Appends the PR reference so the subject ends with ` (#<pr>)`, replacing any
     existing trailing `(#<n>)` (idempotent on re-runs), and asserts the suffix
     is present before merging.
   - Runs `gh pr merge --squash --subject <subject-with-#pr> --body ""` (adding
     `--match-head-commit <sha>` when the head SHA argument is given), then
     confirms the PR reached the `MERGED` state (a merge queue can otherwise exit
     0 while only queuing the PR).

3. **On a validation failure**: relay commitlint's output, propose a corrected
   subject that satisfies the rules (valid type, ≤50 chars), and re-run with the
   corrected subject once confirmed.

4. **Return to the default branch and delete the merged branch**: skip this
   entire step when `--keep-branch` was given, or when the merge did not succeed.

   **Confirm the merge from GitHub first — this is the safety gate.** Never
   delete a branch on the strength of a zero exit code alone:

   ```bash
   test "$(gh pr view "$PR_NUMBER" --json state -q .state)" = "MERGED"
   ```

   If the PR is not `MERGED` (queued, blocked, or the head moved off
   `--match-head-commit`), leave the branch and the checkout exactly as they are
   and report that instead.

   **Refuse to switch away from a dirty worktree**, so unrelated in-progress work
   is never carried onto the default branch or stranded:

   ```bash
   if [ -n "$(git status --porcelain)" ]; then
     echo "Error: worktree is dirty; skipping cleanup" >&2
     exit 1
   fi
   ```

   Report the dirty paths and stop; the PR is already merged, so cleanup can be
   re-run by hand once the tree is clean.

   Then switch, fast-forward, and clean up — in this order:

   ```bash
   MERGED_BRANCH="$BRANCH"
   git switch "$DEFAULT_BRANCH"
   git pull --ff-only origin "$DEFAULT_BRANCH"
   git fetch origin --prune
   if git ls-remote --exit-code --heads origin "$MERGED_BRANCH" >/dev/null 2>&1; then
     git push origin --delete "$MERGED_BRANCH"
   fi
   git branch -D "$MERGED_BRANCH"
   ```

   - **Switch before deleting** — git refuses to delete the branch that is
     checked out.
   - **`--ff-only`** — the default branch must never acquire a merge commit here.
     A non-fast-forward means local default has diverged; stop and report rather
     than reconciling.
   - **`--prune`** drops the remote-tracking ref for branches GitHub already
     deleted (this repo sets `deleteBranchOnMerge`, so the remote branch is
     usually gone before this step runs). The `ls-remote` guard covers the case
     where auto-delete is off, and skips the push when the branch is already gone
     rather than failing on it.
   - **`-D`, not `-d`, is required here** — see the note below. The `MERGED`
     check above is what makes the force safe.

5. **Report results**: state the merged PR number, the final squash subject
   (including the ` (#<pr>)` reference), and confirm the merge succeeded. Note
   the branch returned to, that it was fast-forwarded, and that the merged branch
   was deleted (locally, and remotely when it still existed) — or why cleanup was
   skipped.

## Notes

- The commit message is the subject only; no `--body` content is added, and
  multi-line subjects are rejected.
- The final subject always ends with ` (#<pr>)`; the tool appends and asserts it,
  and the reference is excluded from the 50-char commitlint header limit.
- Validation runs before the merge, so an invalid subject never reaches GitHub.
- Always single-quote the subject argument to avoid shell expansion.
- A non-zero exit after `gh pr merge` means the PR did not actually merge (e.g.
  it was queued or blocked); do not report success in that case, and do not clean
  up the branch.
- **A squash merge always requires `git branch -D`.** Squashing creates a *new*
  commit on the default branch, so the feature branch's tip is never an ancestor
  of it and `git branch -d` reports the branch as "not fully merged" and refuses.
  `-d` may appear to work if the branch's remote-tracking ref still exists and
  matches — git then treats it as merged to its upstream and deletes it with a
  warning — but that is incidental, and it stops working the moment `--prune`
  drops that ref. Do not rely on it. Gate the delete on GitHub reporting `MERGED`,
  which is authoritative, and then force with `-D`.
- The tool itself does not delete the branch or change the checkout; step 4 of
  this skill does, and `--keep-branch` opts out.
