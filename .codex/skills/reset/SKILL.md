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

So the hook install is **gated on reaching the target revision**: if the checkout
cannot be moved there, the hooks are not installed either. Skipping the move but
installing anyway is worse than doing nothing, because it reports a reset that
did not happen and leaves `.git/hooks` holding an arbitrary revision.

**That gate is not the same as being atomic, and this skill does not pretend to
be.** The preconditions in step 1 run before anything is mutated, so a run
rejected there changes nothing. Once step 2 begins, an abort can leave real
intermediate state: the switch may have succeeded while the pull failed (you are
on the target branch, not fast-forwarded), or the pull may have succeeded while
the prune or the install failed. Git offers no transaction across these, so the
obligation is to **report the state reached**, precisely, rather than to claim
none was. Step 5 says which stages completed.

This skill never merges, pushes, or force-updates anything, and never deletes a
branch. It moves the checkout, fast-forwards, and syncs hook files — including
removing installed hooks that no longer exist at the target revision.

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
   half-reset. Commit or stash, then re-run. Untracked files are excluded here;
   they follow a `git switch` harmlessly, and the `--ff-only` pull below still
   stops if one would be overwritten.

   **The hook source directory is the exception — check it for untracked and
   ignored files too:**

   ```bash
   [ -z "$(git status --porcelain --untracked-files=all --ignored -- scripts/git/hooks)" ] || { echo "Error: untracked or ignored files under scripts/git/hooks; nothing was reset" >&2; git status --short --untracked-files=all --ignored -- scripts/git/hooks; exit 1; }
   ```

   Untracked files are harmless anywhere else in the tree, but not here.
   `install-hooks.sh` copies **every** regular file in `scripts/git/hooks/` into
   `.git/hooks` and marks it executable — it does not consult git — so a stray
   file there (`pre-rebase` left over from an experiment, an editor backup, a
   `.gitignore`d scratch script) is installed as a live hook that runs on real
   git operations. Excluding this directory from the untracked check would let a
   reset install arbitrary local content while reporting that it installed the
   target revision's hooks.

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
   # Honor the *complete* upstream: the remote AND the branch name it maps to.
   UPSTREAM_REF=$(git config "branch.$TARGET_BRANCH.merge" 2>/dev/null || echo "refs/heads/$TARGET_BRANCH")
   git pull --ff-only "$REMOTE" "${UPSTREAM_REF#refs/heads/}" || { echo "Error: $TARGET_BRANCH could not fast-forward; hooks not installed" >&2; exit 1; }
   git fetch "$REMOTE" --prune || { echo "Error: prune failed; hooks not installed" >&2; exit 1; }
   ```

   **Resolve the upstream branch name, not just the remote.** A tracking branch
   maps a local name to a remote one through two settings — `branch.X.remote` and
   `branch.X.merge` — and they need not agree. Reading only the remote and then
   pulling `$TARGET_BRANCH` assumes they do: a local `stable` that tracks
   `origin/main` would pull the nonexistent `origin/stable` and fail, or worse,
   fast-forward to the wrong branch where one happens to exist. Falling back to
   `refs/heads/$TARGET_BRANCH` keeps the untracked case working.

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
   marks them executable, **removes installed hooks that no longer exist in the
   source** (leaving git's own `*.sample` files alone), and sets `core.hooksPath`.
   It **overwrites** the installed hooks — that is the point, since hook changes
   arrive as ordinary commits and do nothing until copied. It is idempotent, so
   running it on every reset is cheap and safe.

   **The removal pass is what makes this a sync rather than an overlay.** Copying
   alone cannot express a deletion: a hook removed or renamed at the target
   revision would stay installed and keep running on every commit or push, which
   is the same stale-hook failure this skill exists to prevent — just in the
   direction nobody checks. Any local hand-edits to `.git/hooks/`, and any
   hand-placed hook with no counterpart in the source tree, are lost; that is
   intended and is why the step 1 guards refuse to run on a dirty hook source.

5. **Report the state actually reached** — not a verdict. Name the branch now
   checked out, whether it moved or was already there, whether it fast-forwarded
   (and to what), and which hooks were installed or removed.

   When the run stopped early, say **which stages completed and which did not**,
   because the answer differs by where it stopped:

   - **Rejected in step 1** (dirty worktree, or untracked/ignored files under
     `scripts/git/hooks`) — nothing was touched; the checkout is exactly as it
     was.
   - **Failed in step 2** — still on the original branch, nothing fast-forwarded,
     no hooks installed.
   - **Failed in step 3** — **already switched to the target branch**, but not
     fast-forwarded (or fast-forwarded but not pruned), and no hooks installed.
     This is the case most easily misreported as "nothing happened"; the checkout
     has in fact moved.
   - **Failed in step 4** — branch is current, but `.git/hooks` may hold a
     partially-synced mix. Re-running once the cause is fixed restores it, since
     the install is idempotent.

   Never report a partial run as either a clean reset or a no-op.

## Notes

- **Idempotent by design.** Running it on an already-clean, already-current
  default branch does nothing but reinstall hooks. That is what makes it safe to
  append to the end of `ship-pr` unconditionally.
- **Preconditions first, then honest reporting.** Every check that can be made
  before mutating anything is made in step 1, so the common rejection changes
  nothing. Past that point git offers no transaction, so a failure can leave a
  real intermediate state — most notably switched-but-not-fast-forwarded. The
  skill does not claim otherwise; step 5 reports which stages ran. The one
  deliberate partial is `--skip-hooks`, where the caller asked for the branch
  move alone.
- **The hook source directory gets a stricter cleanliness check than the rest of
  the worktree**, because `install-hooks.sh` copies by directory listing rather
  than by git, so an untracked or ignored file there becomes a live executable
  hook.
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
