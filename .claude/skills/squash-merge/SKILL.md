---
name: squash-merge
description: Squash-merge the current PR with a subject-only commit message validated against the repo's commitlint rules, then return to the PR's base branch, fast-forward it, and delete the merged branch
---

# Squash Merge

Squash-merge the open PR for the current branch with a **subject-only** commit
message — no auto-generated body, commit list, or extended message. The subject
is validated against the repository's own commitlint configuration before the
merge runs, and the tool requires the prepared commit to end with the PR
reference `(#<pr>)` — the same reference GitHub adds for web/default merges.

Once the PR is confirmed `MERGED`, return to the PR's base branch, fast-forward
it, and delete the merged branch, so a shipped PR leaves no local leftovers.

## Arguments

- First argument (optional): the squash commit subject. When omitted, the PR
  title is used. Pass it as a single quoted argument, e.g.
  `"feat(app): add widget"`.
- Second argument (optional): the expected PR head SHA. When given, the merge
  requires local `HEAD` and the pushed PR head to equal it. `ship-pr` uses this
  to guarantee only the reviewed commit is merged.
- Third argument (optional): the expected base branch name. A mismatch fails
  before the push; the push itself still names this exact ref.
- Fourth argument (optional): the expected live base OID. The atomic ref lease
  makes GitHub reject a concurrent base advance at receive time.
- `--keep-branch` (optional flag, position-independent): skip the post-merge
  cleanup (step 4) and stay on the feature branch. Use when the branch is still
  needed locally (e.g. to build a follow-up PR on top of it).

  **This flag is consumed by this skill and must never reach the tool.** The
  tool takes only the four positionals above —
  `squashMerge <subject> <sha> <base-ref> <base-oid>` —
  and how a forwarded `--keep-branch` fails depends on where it lands: first, it
  is read as the *subject* and rejected by commitlint; after the positionals
  (the position `ship-pr` forwards), it is **silently ignored**. The silent case
  is the dangerous one — the merge succeeds, the caller believes cleanup was
  skipped, and it ran anyway. Strip the flag from the arguments, let it gate
  step 4, and call the tool with positionals only.

## Prerequisites

- `git`, `gh` (authenticated), and `jq` on `PATH`.
- The `@symcrypt/agent-tool` package: `packages/agent-tool/src/index.ts`.
- `node_modules` installed (`bun install`) so the commitlint CLI is available.
- An open, mergeable PR on the current branch.
- Local HEAD and the pushed PR head are the same signed, reviewed, non-merge
  commit directly on the live default-branch tip.

## Setup

Check the branch **before** looking up the PR, so running on the default branch
reports that plainly rather than a confusing "no open PR" error. Resolve the PR
number **before** merging — afterwards the PR is no longer open, so
`gh pr list --state open` will not find it:

```bash
ROOT_DIR=$(git rev-parse --show-toplevel)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
AGENT_TOOL="$ROOT_DIR/packages/agent-tool/src/index.ts"
[ -f "$AGENT_TOOL" ] || { echo "Error: agent-tool not found at $AGENT_TOOL" >&2; exit 1; }

# One gh call for both values, split on the space neither a repo slug nor a
# branch name may contain. Guard each: an unauthenticated gh leaves them empty,
# and an empty REPO turns every later lookup into a confusing error.
REPO_INFO=$(gh repo view --json nameWithOwner,defaultBranchRef -q '.nameWithOwner + " " + .defaultBranchRef.name') || { echo "Error: gh repo view failed (authenticated?)" >&2; exit 1; }
CHECKOUT_REPO=${REPO_INFO%% *}
DEFAULT_BRANCH=${REPO_INFO##* }
[ -n "$CHECKOUT_REPO" ] || { echo "Error: could not resolve repository" >&2; exit 1; }
[ -n "$DEFAULT_BRANCH" ] || { echo "Error: repository default branch is unavailable" >&2; exit 1; }
[ "$BRANCH" != "$DEFAULT_BRANCH" ] || { echo "Error: on default branch $DEFAULT_BRANCH" >&2; exit 1; }

if CURRENT_PR_JSON=$(gh pr view --json number,state,url 2>&1); then
  case $(printf '%s' "$CURRENT_PR_JSON" | jq -r '.state') in
    OPEN) ;;
    CLOSED|MERGED) CURRENT_PR_JSON="" ;;
    *) echo "Error: current branch PR has an invalid state" >&2; exit 1 ;;
  esac
else
  case "$CURRENT_PR_JSON" in
    no\ pull\ requests\ found\ for\ branch*) CURRENT_PR_JSON="" ;;
    *) printf 'Error: could not resolve the current branch PR:\n%s\n' "$CURRENT_PR_JSON" >&2; exit 1 ;;
  esac
fi
if [ -n "$CURRENT_PR_JSON" ]; then
  PR_NUMBER=$(printf '%s' "$CURRENT_PR_JSON" | jq -r '.number')
  REPO=$(printf '%s' "$CURRENT_PR_JSON" | jq -r '.url | split("/") | .[-4] + "/" + .[-3]')
else
  REPO="$CHECKOUT_REPO"
  PR_NUMBER=$(gh pr list --head "$BRANCH" --state open --json number --jq '.[0].number' -R "$REPO")
fi
[ -n "$REPO" ] || { echo "Error: could not resolve PR repository" >&2; exit 1; }
[ -n "$PR_NUMBER" ] || { echo "Error: no open PR for branch $BRANCH" >&2; exit 1; }

# The branch to return to is the PR's base — NOT necessarily the default branch.
BASE_BRANCH=$(gh pr view "$PR_NUMBER" --json baseRefName -q .baseRefName -R "$REPO")
[ -n "$BASE_BRANCH" ] || { echo "Error: could not resolve base branch for PR #$PR_NUMBER" >&2; exit 1; }

PR_HEAD_JSON=$(gh pr view "$PR_NUMBER" --json headRefName,headRefOid,headRepository -R "$REPO")
PR_HEAD_BRANCH=$(printf '%s' "$PR_HEAD_JSON" | jq -r '.headRefName // ""')
PR_HEAD_OID=$(printf '%s' "$PR_HEAD_JSON" | jq -r '.headRefOid // ""')
PR_HEAD_REPO=$(printf '%s' "$PR_HEAD_JSON" | jq -r '.headRepository.nameWithOwner // ""')
[ "$PR_HEAD_BRANCH" = "$BRANCH" ] || { echo "Error: PR head branch is not $BRANCH" >&2; exit 1; }
[ -n "$PR_HEAD_OID" ] || { echo "Error: could not resolve PR head OID" >&2; exit 1; }
[ -n "$PR_HEAD_REPO" ] || { echo "Error: could not resolve PR head repository" >&2; exit 1; }

BASE_REPO_HTTPS_URL=$(gh repo view "$REPO" --json url -q .url)
BASE_REPO_HOST=${BASE_REPO_HTTPS_URL#*://}
BASE_REPO_HOST=${BASE_REPO_HOST%%/*}
case $(gh config get git_protocol --host "$BASE_REPO_HOST") in
  ssh) BASE_REPO_URL=$(gh repo view "$REPO" --json sshUrl -q .sshUrl) ;;
  https) BASE_REPO_URL="$BASE_REPO_HTTPS_URL" ;;
  *) echo "Error: unsupported git protocol for $BASE_REPO_HOST" >&2; exit 1 ;;
esac

HEAD_REPO_HTTPS_URL=$(gh repo view "$PR_HEAD_REPO" --json url -q .url)
HEAD_REPO_HOST=${HEAD_REPO_HTTPS_URL#*://}
HEAD_REPO_HOST=${HEAD_REPO_HOST%%/*}
case $(gh config get git_protocol --host "$HEAD_REPO_HOST") in
  ssh) HEAD_REPO_URL=$(gh repo view "$PR_HEAD_REPO" --json sshUrl -q .sshUrl) ;;
  https) HEAD_REPO_URL="$HEAD_REPO_HTTPS_URL" ;;
  *) echo "Error: unsupported git protocol for $HEAD_REPO_HOST" >&2; exit 1 ;;
esac
```

The initial current-branch discovery is intentionally unqualified so `gh` can
follow a fork branch to its upstream PR. After deriving `REPO`, pass
`-R "$REPO"` to every numbered-PR lookup, as the tool does internally. Those
lookups gate a merge and branch deletion, so they must resolve to the PR owner.

**Return to the PR's base branch, not the repository default.** They coincide for
a PR opened by `open-pr` (which bases on the default), but a stacked PR or a
release-branch PR merges somewhere else. Switching to the default there would
fast-forward a branch that never received the commits and then delete the feature
branch on the strength of a merge that landed elsewhere. The `MERGED` gate does
not catch this — it confirms the PR merged, not that *this* branch contains it.
The `$BRANCH` != `$DEFAULT_BRANCH` preflight above is a separate guard and stays
as-is.

## Workflow

1. **Determine the subject**: If the user supplied a subject, use it verbatim.
   Otherwise the tool falls back to the PR title. Do not compose a body or
   extended message — the already-reviewed squash commit must contain only the
   subject and end in the authoritative `(#<pr>)` reference.

2. **Run the squash merge**:

   ```bash
   bun "$AGENT_TOOL" squashMerge 'feat(app): add widget'
   # or, to default to the PR title:
   bun "$AGENT_TOOL" squashMerge
   # or, bind the merge to a specific reviewed head commit:
   bun "$AGENT_TOOL" squashMerge 'feat(app): add widget' "$REVIEWED_SHA"
   # or, also refuse a PR retargeted after the caller validated its base:
   bun "$AGENT_TOOL" squashMerge 'feat(app): add widget' "$REVIEWED_SHA" "$BASE_REF" "$BASE_OID"
   ```

   **Quote the subject in single quotes** so the shell does not expand
   `$(...)`, backticks, or `$VAR` before the tool sees it — the subject must
   reach `commitlint` only as a literal argv value. If the subject itself
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
   - Requires the reviewed PR head to be one non-merge commit whose sole parent
     is the validated live base and whose subject ends with the authoritative
     `(#<pr>)` reference.
   - Refuses a PR that already has a queued or automatic merge, then atomically
     fast-forwards the explicitly named default-branch ref to that reviewed
     squash commit with `--force-with-lease=<base-ref>:<base-oid>`. The active,
     non-bypassable PR and strict-check rules are enforced by GitHub at receive
     time; a retarget, head move, or base advance makes the push fail.
   - Confirms the PR reached the `MERGED` state before cleanup.

3. **On a validation failure**: relay commitlint's output, propose a corrected
   subject that satisfies the rules (valid type, ≤50 chars), and re-run with the
   corrected subject once confirmed.

4. **Return to the base branch and delete the merged branch**: skip this entire
   step when `--keep-branch` was given, or when the merge did not succeed.

   **Confirm the merge from GitHub first — this is the safety gate.** Never
   delete a branch on the strength of a zero exit code alone:

   ```bash
   PR_STATE=$(gh pr view "$PR_NUMBER" --json state -q .state -R "$REPO")
   [ "$PR_STATE" = "MERGED" ] || { echo "Error: PR #$PR_NUMBER is $PR_STATE, not MERGED; skipping cleanup" >&2; exit 1; }
   ```

   If the PR is not `MERGED` (blocked, retargeted, or moved off the reviewed head),
   leave the branch and the checkout exactly as they are and report that instead.

   **Refuse to switch away from a dirty worktree**, so unrelated in-progress work
   is never carried onto the base branch or stranded:

   ```bash
   [ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "Error: worktree has uncommitted changes; skipping cleanup" >&2; git status --short; exit 1; }
   ```

   Report the dirty paths and stop; the PR is already merged, so cleanup can be
   re-run by hand once the tree is clean. Untracked files are excluded — they
   follow a `git switch` harmlessly, and the guarded `git pull` below still stops
   if one would be overwritten.

   Then switch, fast-forward, **verify the merge actually arrived**, and only then
   delete — in this order, and **guard every step**, so a failure stops the
   sequence instead of falling through to the delete:

   ```bash
   MERGED_BRANCH="$BRANCH"
   MERGE_COMMIT=$(gh pr view "$PR_NUMBER" --json mergeCommit -q .mergeCommit.oid -R "$REPO")
   # Pull from the repository that owns the PR base. The separately resolved
   # head repository binds any remote deletion to the PR's actual source.

   git switch "$BASE_BRANCH" || { echo "Error: could not switch to $BASE_BRANCH" >&2; exit 1; }
   git pull --ff-only "$BASE_REPO_URL" "$BASE_BRANCH" || { echo "Error: $BASE_BRANCH could not fast-forward; skipping delete" >&2; exit 1; }

   # The real gate on the delete: prove this branch now contains the squash commit.
   [ -n "$MERGE_COMMIT" ] || { echo "Error: could not resolve merge commit; skipping delete" >&2; exit 1; }
   git merge-base --is-ancestor "$MERGE_COMMIT" HEAD || { echo "Error: $BASE_BRANCH does not contain merge commit $MERGE_COMMIT; skipping delete" >&2; exit 1; }
   [ "$(git rev-parse "$MERGED_BRANCH")" = "$PR_HEAD_OID" ] || { echo "Error: local $MERGED_BRANCH moved after merge; skipping delete" >&2; exit 1; }

   REMOTE_HEAD_OUTPUT=$(git ls-remote "$HEAD_REPO_URL" "refs/heads/$PR_HEAD_BRANCH") || { echo "Error: could not read remote $PR_HEAD_REPO:$PR_HEAD_BRANCH; skipping delete" >&2; exit 1; }
   REMOTE_HEAD_OID=$(printf '%s\n' "$REMOTE_HEAD_OUTPUT" | awk 'NR == 1 { print $1 }')
   if [ -n "$REMOTE_HEAD_OID" ]; then
     [ "$REMOTE_HEAD_OID" = "$PR_HEAD_OID" ] || { echo "Error: remote $PR_HEAD_REPO:$PR_HEAD_BRANCH moved after merge; skipping delete" >&2; exit 1; }
     git push --force-with-lease="refs/heads/$PR_HEAD_BRANCH:$PR_HEAD_OID" "$HEAD_REPO_URL" --delete "$PR_HEAD_BRANCH" || { echo "Error: could not safely delete remote $PR_HEAD_REPO:$PR_HEAD_BRANCH" >&2; exit 1; }
   fi
   for REMOTE_NAME in $(git remote); do
     REMOTE_URL=$(git remote get-url "$REMOTE_NAME") || { echo "Error: could not resolve remote $REMOTE_NAME" >&2; exit 1; }
     REMOTE_REPO=$(gh repo view "$REMOTE_URL" --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)
     [ "$REMOTE_REPO" != "$PR_HEAD_REPO" ] || git update-ref -d "refs/remotes/$REMOTE_NAME/$PR_HEAD_BRANCH" || { echo "Error: could not prune $REMOTE_NAME/$PR_HEAD_BRANCH" >&2; exit 1; }
   done
   git branch -d "$MERGED_BRANCH" || { echo "Error: could not delete local $MERGED_BRANCH" >&2; exit 1; }
   ```

   - **Switch before deleting** — git refuses to delete the branch that is
     checked out.
   - **`--ff-only`** — the base branch must never acquire a merge commit here.
     A non-fast-forward means it has diverged locally; stop and report rather
     than reconciling. The guard is what makes that happen: without it the
     sequence would continue and delete the branch anyway.
   - **Verify the merge commit is an ancestor of `HEAD`** before deleting
     anything. This is what makes the delete safe in practice: it proves the
     branch you just pulled genuinely contains the squashed work, catching a pull
     from the wrong remote, a stale fork, or a base that never received the merge
     — none of which the `MERGED` state alone can detect.
   - The remote delete is bound to the captured PR head OID twice: an explicit
     comparison catches an already-moved branch, and `--force-with-lease`
     atomically rejects a push racing the delete. The local branch must still
     point to that same OID before `-D` is allowed. After deletion, the exact
     remote-tracking ref is removed from every named remote GitHub identifies as
     the PR head repository, so standalone cleanup does not retain a stale ref.
   - **`-D`, not `-d`, is required here** — see the note below. The `MERGED` check
     plus the ancestry check above are what make the force safe.

5. **Report results**: state the merged PR number, the final squash subject
   (including the `(#<pr>)` reference), and confirm the merge succeeded. Name the
   base branch returned to, that it was fast-forwarded and verified to contain the
   merge commit, and that the merged branch was deleted (locally, and remotely when
   it still existed) — or why cleanup was skipped.

## Notes

- The commit message is the subject only; no `--body` content is added, and
  multi-line subjects are rejected.
- The final subject always ends with a space followed by `(#<pr>)`; the tool
  asserts it, and the reference is excluded from the 50-char
  commitlint header limit.
- Validation runs before the merge, so an invalid subject never reaches GitHub.
- Always single-quote the subject argument to avoid shell expansion.
- A non-zero exit from the atomic squash push means the PR did not actually
  merge; do not report success or clean up the branch. The tool refuses an
  existing queued/automatic merge and never creates one as a fallback.
- The reviewed squash commit becomes the base tip, so ordinary
  `git branch -d` proves it is merged before deleting the local branch.
  `-d` may appear to work if the branch's remote-tracking ref still exists and
  matches — git then treats it as merged to its upstream and deletes it with a
  warning — but that is incidental, and it stops working the moment `--prune`
  drops that ref. Do not rely on it. Gate the delete on GitHub reporting `MERGED`,
  which is authoritative, and then force with `-D`.
- The tool itself does not delete the branch or change the checkout, and knows
  nothing of `--keep-branch`; step 4 of this skill owns all of that. A caller that
  invokes the tool directly gets the merge **without** the cleanup.
