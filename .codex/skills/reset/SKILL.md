---
name: reset
description: Return the checkout to the repository default branch, fast-forward it, and reinstall the repo's git hooks — the end-of-flow reset ship-pr runs after a merge
---

# Reset

Put the checkout back into a clean starting state: on the **repository default
branch**, **fast-forwarded** to its remote, with the repo's **git hooks
reinstalled** from `scripts/git/install-hooks.sh`.

This is the step `ship-pr` runs last, but it stands on its own — run it any time
the checkout has drifted (left on a stale feature branch, or with hooks that
predate a merged change to `scripts/git/hooks/`).

**Order matters: branch first, hooks second.** The hooks are copied out of the
worktree, so installing them before fast-forwarding would install whatever
version the old checkout had. Reaching the default branch first means the hooks
installed are the ones that just landed on it.

This skill never merges, pushes, or deletes anything. It moves the checkout,
fast-forwards, and copies hook files.

## Arguments

- First argument (optional): the branch to reset to. Defaults to the repository
  default branch (`gh repo view -q .defaultBranchRef.name`). Pass one only to
  reset onto a long-lived branch that is not the default (e.g. a release
  branch); it must already exist locally or on the remote.
- `--skip-hooks` (optional flag): move and fast-forward the branch, but do not
  reinstall hooks.

## Prerequisites

- `git` on `PATH`, and `gh` (authenticated) when the target branch is defaulted
  — it is only used to resolve the default branch name.
- `scripts/git/install-hooks.sh` in the repository.

## Setup

```bash
ROOT_DIR=$(git rev-parse --show-toplevel)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
HOOKS_SCRIPT="$ROOT_DIR/scripts/git/install-hooks.sh"

# Only when no target branch argument was given:
TARGET_BRANCH=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name) || { echo "Error: gh repo view failed (authenticated?)" >&2; exit 1; }
[ -n "$TARGET_BRANCH" ] || { echo "Error: repository default branch is unavailable" >&2; exit 1; }
```

## Workflow

1. **Detect a dirty worktree — record it, do not exit.** Switching branches with
   uncommitted tracked changes carries in-progress work onto the target branch or
   strands it, so a dirty tree skips the branch move. It must **not** abort the
   run: hooks live in `.git/hooks`, outside the worktree, so step 4 is still safe
   and is usually the reason the reset was asked for. Set a flag instead of
   exiting:

   ```bash
   WORKTREE_DIRTY=
   if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
     WORKTREE_DIRTY=1
     echo "Warning: worktree has uncommitted changes; skipping the branch move" >&2
     git status --short
   fi
   ```

   Report the dirty paths and **skip steps 2–3**, then go on to step 4.
   Untracked files are excluded; they follow a `git switch` harmlessly, and the
   `--ff-only` pull below still stops if one would be overwritten.

2. **Switch to the target branch**, if not already on it — skipped entirely on a
   dirty tree:

   ```bash
   if [ -z "$WORKTREE_DIRTY" ] && [ "$BRANCH" != "$TARGET_BRANCH" ]; then
     git switch "$TARGET_BRANCH" || { echo "Error: could not switch to $TARGET_BRANCH" >&2; exit 1; }
   fi
   ```

   Already being on it is the common case after `ship-pr` — `squash-merge`
   returns to the PR's base branch as part of its own gated cleanup. Treat that
   as success, not a no-op to report as a problem.

3. **Fast-forward it** from the remote the branch actually tracks — on a fork,
   `origin` is the fork and a hardcoded remote pulls a stale branch. Also skipped
   on a dirty tree:

   ```bash
   if [ -z "$WORKTREE_DIRTY" ]; then
     REMOTE=$(git config "branch.$TARGET_BRANCH.remote" 2>/dev/null || echo origin)
     git pull --ff-only "$REMOTE" "$TARGET_BRANCH" || { echo "Error: $TARGET_BRANCH could not fast-forward" >&2; exit 1; }
     git fetch "$REMOTE" --prune || { echo "Error: prune failed" >&2; exit 1; }
   fi
   ```

   **`--ff-only`** — the target branch must never acquire a merge commit here. A
   non-fast-forward means it has diverged locally; stop and report rather than
   reconciling. Do not continue to step 4 with a diverged branch: its hooks are
   not the ones on the remote, which is exactly what this skill exists to
   correct.

4. **Reinstall the git hooks**, unless `--skip-hooks` was given:

   ```bash
   [ -f "$HOOKS_SCRIPT" ] || { echo "Error: install-hooks.sh not found at $HOOKS_SCRIPT" >&2; exit 1; }
   sh "$HOOKS_SCRIPT" || { echo "Error: install-hooks.sh failed" >&2; exit 1; }
   ```

   Invoke it through `sh` rather than executing it directly, and test for `-f`
   rather than `-x`: the source files under `scripts/git/hooks/` are not all
   marked executable in the tree — the installer is what `chmod +x`es them at the
   destination — so do not assume the mode bit here either.

   The script copies every file from `scripts/git/hooks/` into `.git/hooks/`,
   marks them executable, and sets `core.hooksPath`. It **overwrites** the
   installed hooks — that is the point, since hook changes arrive as ordinary
   commits and do nothing until copied. It is idempotent, so running it on every
   reset is cheap and safe. Any local hand-edits to `.git/hooks/` are lost; that
   is intended.

5. **Report results**: the branch now checked out, whether it moved or was
   already there, whether it fast-forwarded (and to what), and which hooks were
   installed. When a step was skipped — dirty worktree, `--skip-hooks` — say so
   and what was left in place.

## Notes

- **Idempotent by design.** Running it on an already-clean, already-current
  default branch does nothing but reinstall hooks. That is what makes it safe to
  append to the end of `ship-pr` unconditionally.
- **It is not the post-merge cleanup.** Returning to the PR's base branch and
  deleting the merged branch belong to `squash-merge`, gated on GitHub reporting
  `MERGED` and on the base verifiably containing the merge commit. This skill
  knows nothing about PRs and must never delete a branch — it runs after that
  cleanup, and re-asserting the checkout is all it adds.
- **The target is the repository default, not a PR base.** Those coincide for a
  PR `open-pr` created. For a stacked PR whose base is another feature branch,
  `squash-merge` returns to that base and this skill then moves on to the
  default — pass the base as the branch argument if that is not wanted.
- **`--ff-only` failure is a real signal**, not a nuisance: the default branch
  has local commits that were never pushed. Resolve that by hand; do not force.
</content>
</invoke>
