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

**Order matters: branch first, hooks second — and the branch step is a
precondition, not a preference.** `install-hooks.sh` copies hooks *out of*
`scripts/git/hooks/` in the worktree into `.git/hooks`. The destination is
outside the worktree, but the **source is not**, so what lands in `.git/hooks` is
whatever revision the checkout currently holds. Installing before reaching the
target branch would install the stale branch's hooks — or uncommitted edits to
them — which is precisely the state this skill exists to correct.

That makes the reset **all-or-nothing**: if the checkout cannot be moved to the
target revision, the hooks are not installed either. Skipping the move but
installing anyway is worse than doing nothing, because it reports a reset that
did not happen and leaves `.git/hooks` holding an arbitrary revision.

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

1. **Stop on a dirty worktree — change nothing.** Switching branches with
   uncommitted tracked changes carries in-progress work onto the target branch or
   strands it, so the move cannot run. Because the hook install reads its source
   from the worktree, it cannot run either: without the move, it would copy the
   current branch's hooks (or uncommitted edits to them) into `.git/hooks` and
   report a reset that never happened. Stop before touching anything:

   ```bash
   [ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "Error: worktree has uncommitted changes; nothing was reset" >&2; git status --short; exit 1; }
   ```

   Report the dirty paths and say plainly that **neither** the branch nor the
   hooks were touched, so the caller knows the checkout is unchanged rather than
   half-reset. Commit or stash, then re-run. Untracked files are excluded; they
   follow a `git switch` harmlessly, and the `--ff-only` pull below still stops if
   one would be overwritten.

2. **Switch to the target branch**, if not already on it:

   ```bash
   [ "$BRANCH" = "$TARGET_BRANCH" ] || git switch "$TARGET_BRANCH" || { echo "Error: could not switch to $TARGET_BRANCH" >&2; exit 1; }
   ```

   Already being on it is the common case after `ship-pr` — `squash-merge`
   returns to the PR's base branch as part of its own gated cleanup. Treat that
   as success, not a no-op to report as a problem.

3. **Fast-forward it** from the remote the branch actually tracks — on a fork,
   `origin` is the fork and a hardcoded remote pulls a stale branch:

   ```bash
   REMOTE=$(git config "branch.$TARGET_BRANCH.remote" 2>/dev/null || echo origin)
   git pull --ff-only "$REMOTE" "$TARGET_BRANCH" || { echo "Error: $TARGET_BRANCH could not fast-forward; hooks not installed" >&2; exit 1; }
   git fetch "$REMOTE" --prune || { echo "Error: prune failed" >&2; exit 1; }
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
   installed. When the run stopped early — a dirty worktree or a failed
   fast-forward — say that **nothing** was reset and name what blocked it, rather
   than reporting the steps that did run as a partial success.

## Notes

- **Idempotent by design.** Running it on an already-clean, already-current
  default branch does nothing but reinstall hooks. That is what makes it safe to
  append to the end of `ship-pr` unconditionally.
- **All-or-nothing.** Every abort path leaves the checkout untouched, because a
  hook install that runs without the branch move would copy an arbitrary
  revision's hooks into `.git/hooks`. The one deliberate partial is
  `--skip-hooks`, where the caller asked for the branch move alone.
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
