---
name: ship-pr
description: Ship current work end-to-end — commit on a feature branch, cross-agent review and repair it, open or resume its PR with a single push after the review, squash-merge the exact reviewed commit, then return to the base branch, delete the merged branch, and reset the checkout
---

# Ship PR

Run the full ship flow for the current work: **commit the work on a feature
branch**, get a **cross-agent review** that repairs its own blocking findings,
**open or resume its PR**, then **squash-merge** and clean up. The PR is opened
*after* the review, so a fresh branch is pushed **once** — through the pre-push
hook once — instead of once at open time and again for each repair round.
Delegate PR creation, the review-and-repair loop, and the final merge to the
`open-pr`, `cross-agent-review`, `squash-merge`, and `reset` skills. This skill
owns the ordering and the merge gate; it does not re-implement the wrapped
skills.

The review gates the merge. `cross-agent-review` addresses actionable blocking
findings and re-reviews every head it changes, then reports the final reviewed
SHA and verdict. This skill merges that exact SHA, and only on a non-blocking
verdict. Never merge a commit that was not itself reviewed.

A successful flow ends back on the PR's base branch — the default branch for a PR
`open-pr` created — fast-forwarded, with the merged branch deleted, and with the
repo's git hooks reinstalled. That cleanup belongs to `squash-merge`, which runs
it only after GitHub confirms the PR is `MERGED` and that the base branch
actually contains the merge commit; the final checkout reset belongs to `reset`.

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

- `git`, `gh` (authenticated), and `jq` on `PATH`.
- The `@symcrypt/agent-tool` package: `packages/agent-tool/src/index.ts`.
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
CHECKOUT_REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
REPO="$CHECKOUT_REPO"
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

   First look up whether an open PR already exists for the branch. Prefer
   `gh pr view --json number,state,url` without `-R`, which follows the current
   branch to an upstream PR from a fork; derive `REPO` from that PR URL. Fall
   back to `gh pr list --head "$BRANCH" --state open -R "$CHECKOUT_REPO"` only
   when the current branch has no PR. One may remain from a prior gated run.
   Then take the matching case:

   ```bash
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
   ```

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

   If no title argument was supplied, capture the intended PR title now — the work
   commit's subject (`git log -1 --format=%s`) — and reuse it when opening the PR
   in step 3. The review may add repair commits, so letting `open-pr` default the
   title *after* the review would derive it from a repair commit's subject rather
   than the work; the squash subject would inherit that too.

   `cross-agent-review` reads the current branch either way: with `PR_NUMBER`
   empty it reviews the local commits against the default branch; with the
   resumed PR open it reviews the pushed head.

2. **Review and repair** — invoke `cross-agent-review`, forwarding the
   review-agent argument, and `--passes <n>` / `--repair-rounds <n>` when given.

   That skill owns the review, the severity gate, and the bounded repair loop:
   for each candidate head it first brings the branch up to date with its base
   (a merge of the latest base — local while there is no PR, so this flow's
   single push is preserved), snapshots the head — the pushed PR head when one
   is open, the local HEAD otherwise — reviews it, repairs blocking findings
   (committing locally when there is no PR, pushing when there is), and
   re-reviews every head it changes. It reports back a **head SHA**, a
   **verdict**, and the **repair rounds** it performed. The SHA is a reviewed
   head on every verdict except **review-could-not-run**, where it is the
   unreviewed candidate head — only reachable here via `--merge-anyway`.

   Relay its output — which agent ran, whether it fell back, the findings, and
   what was repaired.

   Take its reported head SHA as `REVIEWED_SHA` and confirm it is still the local
   HEAD — and, when a PR is already open, the pushed head too:

   ```bash
   REVIEWED_SHA=<final reviewed SHA reported by cross-agent-review>
   test "$REVIEWED_SHA" = "$(git rev-parse HEAD)"
   [ -z "$PR_NUMBER" ] || test "$REVIEWED_SHA" = "$(gh pr view "$PR_NUMBER" --json headRefOid -q .headRefOid -R "$REPO")"
   ```

   If either differs, a commit landed after the loop finished. Discard the
   result, reconcile safely, and re-run `cross-agent-review` on the new head.
   Never carry a stale SHA into the later steps.

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
     and the GraphQL `expectedHeadOid` bind still apply to it, so the merge is still
     pinned to a known commit — it simply is not a reviewed one. Say so.

   When `--merge-anyway` is set and the gate would otherwise stop, surface the
   blocking or unavailable findings, state plainly that the gate is being
   overridden, and proceed to steps 3–4.

   **Never repair here.** Fixing a finding in this step would produce a head that
   `cross-agent-review` never read, and `REVIEWED_SHA` would no longer describe
   the commit being merged. Raise `--repair-rounds` instead.

3. **Open the PR — the single push, bound to the reviewed head**:

   - **No PR yet** (the fresh path, `PR_NUMBER` empty): invoke `open-pr` with the
     title argument (or the title captured in step 1), piping the body via stdin.
     The worktree is clean after the review, so `open-pr` commits nothing new; it
     pushes the branch
     **once** — the only push of the flow, and the one that goes through the
     pre-push hook — and opens the PR. Capture its number and URL, and set
     `PR_NUMBER`. Derive `REPO` from the returned PR URL before any base or rules
     lookup. Stop if creation fails.
   - **A PR is already open** (the resume path from step 1): it is already pushed
     with the reviewed repairs; do **not** call `open-pr`. Reuse its number, URL,
     and title.

   On either path, bind later lookups to the repository that owns the PR:

   ```bash
   REPO=$(printf '%s' "$PR_URL" | jq -Rr 'split("/") | .[-4] + "/" + .[-3]')
   [ -n "$REPO" ] || { echo "Error: could not resolve the PR base repository" >&2; exit 1; }
   ```

   Then confirm the pushed PR head is exactly the reviewed head, so step 4 binds
   the merge to a commit a review actually read:

   ```bash
   test "$REVIEWED_SHA" = "$(git rev-parse HEAD)"
   test "$REVIEWED_SHA" = "$(gh pr view "$PR_NUMBER" --json headRefOid -q .headRefOid -R "$REPO")"
   ```

   If either differs — `open-pr` committed a stray change, or the head moved —
   reconcile and re-review before merging; never merge a head the review did not
   read.

   **Sole exception — the pre-push co-author strip.** `checkCommitTrust`
   rejects `Co-authored-by` trailers; the only remedy is a message rewrite,
   which moves the SHA but not the content. When that is the only reason the
   head moved, do **not** re-review. Verify and re-pin:

   ```bash
   COAUTHOR_BASE_OID=$(gh pr view "$PR_NUMBER" --json baseRefOid -q .baseRefOid -R "$REPO")
   COAUTHOR_BASE_HTTPS_URL=$(gh repo view "$REPO" --json url -q .url)
   COAUTHOR_BASE_HOST=${COAUTHOR_BASE_HTTPS_URL#*://}
   COAUTHOR_BASE_HOST=${COAUTHOR_BASE_HOST%%/*}
   case $(gh config get git_protocol --host "$COAUTHOR_BASE_HOST") in
     ssh) COAUTHOR_BASE_URL=$(gh repo view "$REPO" --json sshUrl -q .sshUrl) ;;
     https) COAUTHOR_BASE_URL="$COAUTHOR_BASE_HTTPS_URL" ;;
     *) echo "Error: unsupported git protocol for $COAUTHOR_BASE_HOST" >&2; exit 1 ;;
   esac
   git fetch "$COAUTHOR_BASE_URL" "$COAUTHOR_BASE_OID" || { echo "Error: could not fetch PR base $COAUTHOR_BASE_OID" >&2; exit 1; }
   test "$(git rev-parse FETCH_HEAD)" = "$COAUTHOR_BASE_OID"
   test "$(git rev-parse "$REVIEWED_SHA^{tree}")" = "$(git rev-parse "HEAD^{tree}")"
   test "$(git merge-base "$REVIEWED_SHA" "$COAUTHOR_BASE_OID")" = "$(git merge-base HEAD "$COAUTHOR_BASE_OID")"
   REVIEWED_SHA=$(git rev-parse HEAD)
   ```

   GitHub squashes from the merge base — changed ancestry could merge a diff
   no review read even with equal trees. The message diff must remove only
   `Co-authored-by` lines; anything else keeps the rule above.

   **Refresh the base immediately before merging.** The base may advance while
   the review or the pre-push hook is running. A head that was current when it
   was reviewed can therefore become `BEHIND` before step 4. Set
   `BASE_REFRESH_ROUND=0` and allow at most two base-refresh rounds for the whole
   ship run.

   This retry is safe only when GitHub atomically requires the head to contain
   the latest base before merging **and the authenticated actor cannot bypass
   that requirement**. Resolve the effective repository rules for the PR base,
   then require an active strict-status ruleset whose detail reports
   `current_user_can_bypass: never`. If the rules or ruleset detail cannot be
   read, stop with the PR open rather than relying on a racy client-side check:

   ```bash
   BASE_REF=$(gh pr view "$PR_NUMBER" --json baseRefName -q .baseRefName -R "$REPO")
   BASE_REF_PATH=$(jq -rn --arg ref "$BASE_REF" '$ref | @uri')
   STRICT_RULESET_IDS=$(gh api "repos/$REPO/rules/branches/$BASE_REF_PATH" --jq '[.[] | select(.type == "required_status_checks" and .parameters.strict_required_status_checks_policy == true and ((.parameters.required_status_checks // []) | length > 0)) | .ruleset_id] | unique | .[]') || { echo "Error: could not read effective rules for $REPO:$BASE_REF" >&2; exit 1; }
   [ -n "$STRICT_RULESET_IDS" ] || { echo "Error: $REPO:$BASE_REF has no strict status-check ruleset" >&2; exit 1; }
   NON_BYPASS_STRICT=false
   for RULESET_ID in $STRICT_RULESET_IDS; do
     RULESET_ENFORCES=$(gh api "repos/$REPO/rulesets/$RULESET_ID" --jq '(.enforcement == "active") and (.current_user_can_bypass == "never") and ([.rules[] | select(.type == "required_status_checks" and .parameters.strict_required_status_checks_policy == true and ((.parameters.required_status_checks // []) | length > 0))] | length > 0)') || { echo "Error: could not verify ruleset $RULESET_ID" >&2; exit 1; }
     [ "$RULESET_ENFORCES" != "true" ] || NON_BYPASS_STRICT=true
   done
   [ "$NON_BYPASS_STRICT" = "true" ] || { echo "Error: the authenticated actor can bypass strict base freshness for $REPO:$BASE_REF" >&2; exit 1; }
   gh pr checks "$PR_NUMBER" --required --watch --fail-fast -R "$REPO" || { echo "Error: required checks did not pass for PR #$PR_NUMBER" >&2; exit 1; }
   ```

   Waiting for required checks readies the synchronous merge mutation; that
   mutation never falls back to a latent automatic merge. A non-bypassable
   server-side rule then closes the fetch-to-merge race: if the base advances
   after the check below, GitHub rejects the stale merge and the retry path can
   refresh and re-review it. Before every merge attempt, resolve and fetch the
   exact current base OID from the repository that owns the PR rather than
   assuming the local `origin` is that repository:

   ```bash
   BASE_REPO_HTTPS_URL=$(gh repo view "$REPO" --json url -q .url)
   BASE_REPO_HOST=${BASE_REPO_HTTPS_URL#*://}
   BASE_REPO_HOST=${BASE_REPO_HOST%%/*}
   case $(gh config get git_protocol --host "$BASE_REPO_HOST") in
     ssh) BASE_REPO_URL=$(gh repo view "$REPO" --json sshUrl -q .sshUrl) ;;
     https) BASE_REPO_URL="$BASE_REPO_HTTPS_URL" ;;
     *) echo "Error: unsupported git protocol for $BASE_REPO_HOST" >&2; exit 1 ;;
   esac
   BASE_OID=$(gh pr view "$PR_NUMBER" --json baseRefOid -q .baseRefOid -R "$REPO")
   [ -n "$BASE_REPO_URL" ] && [ -n "$BASE_OID" ] || { echo "Error: could not resolve the base repository snapshot" >&2; exit 1; }
   git fetch "$BASE_REPO_URL" "$BASE_OID" || { echo "Error: could not fetch $BASE_REF at $BASE_OID from $BASE_REPO_URL" >&2; exit 1; }
   test "$(git rev-parse FETCH_HEAD)" = "$BASE_OID" || { echo "Error: fetched base does not match $BASE_OID" >&2; exit 1; }
   git merge-base --is-ancestor "$BASE_OID" "$REVIEWED_SHA"
   ```

   When the ancestor check succeeds, the reviewed head contains the fetched
   base and step 4 may proceed. When it fails, do not merge the base here and do
   not push an unreviewed commit. If `--repair-rounds 0` was given, stop with
   the PR open: report-only review intentionally skips base synchronization, so
   it cannot produce a current reviewed head. Otherwise, increment
   `BASE_REFRESH_ROUND` and invoke `cross-agent-review` again with the same
   agent, pass, and repair-round arguments. With the PR now open, that skill
   owns merging the latest base, pushing the updated head without force, and
   reviewing the integrated result. Apply the same verdict gate as step 2,
   replace `REVIEWED_SHA` with the SHA it reports, verify it against local
   `HEAD` and the PR head, then repeat this freshness check. Stop with the PR
   open if a third refresh would be required.

   A base refresh is not a repair round: it responds to external base movement,
   while repair rounds address reviewer findings. It still requires a complete
   re-review because merging the base changes the candidate head and can change
   the PR diff.

4. **Squash-merge and clean up (bound to the reviewed head)** — invoke the
   `squash-merge` skill, passing `REVIEWED_SHA` as its **second (head-SHA)
   argument** so the direct merge mutation uses `expectedHeadOid` and GitHub
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

   The empty subject falls back to the PR title captured when the PR was opened
   or resumed (step 3, or step 1 on the resume path), to which the tool appends
   the `(#<pr>)` reference; it validates the subject with commitlint and
   refuses PRs that already have a queued or automatic merge, and confirms the
   PR reached `MERGED` before returning. A non-zero result means the PR did not
   actually merge (blocked, or the head moved off `REVIEWED_SHA`) — do not
   report success in that case. The direct mutation never leaves a latent merge
   queued for a later, unreviewed base.

   The only retryable merge failure is an open PR whose merge state is
   `BEHIND`: the base advanced after the final freshness fetch. Return to step
   3's base-refresh gate, which synchronizes and re-reviews before producing a
   new `REVIEWED_SHA`, subject to its two-round bound. For any other non-zero
   result, stop with the PR and checkout intact. Never retry the merge with the
   stale SHA, bypass the review, or run cleanup after a failed merge.

5. **Reset the checkout** — invoke the `reset` skill with no arguments, but only
   when the merge landed and `--keep-branch` was **not** given. It puts the
   checkout on the repository default branch, fast-forwards it, and reinstalls
   the git hooks from `scripts/git/install-hooks.sh`.

   After step 4 the checkout is normally already on the base branch and current,
   so the branch half is a no-op; the hooks half is the point. Hook changes
   arrive as ordinary commits under `scripts/git/hooks/` and do nothing until
   they are copied into `.git/hooks`, so a flow that just merged one would
   otherwise leave the stale hook installed until someone noticed. Running the
   install *after* the fast-forward is what makes the freshly merged version the
   one installed.

   Skip it when `--keep-branch` was given — that flag exists to stay on the
   feature branch, and resetting would undo it — and when the merge did not land,
   since the branch and checkout must be left exactly as they are for the
   re-review. A `reset` failure does not invalidate the merge: report it and
   continue to step 6.

6. **Report results**: the PR URL, review agent and fallback status, repair rounds
   performed, findings fixed or waived, and the final squash subject including
   its `(#<pr>)` reference. Note that the branch was pushed once, at open time
   (or, on the resume path, that it was already open). Confirm the merge reached
   `MERGED`, and state the branch returned to, that the merged branch was
   deleted, and that the hooks were reinstalled — or, when cleanup or the reset
   was skipped (`--keep-branch`, a dirty worktree, a merge that did not land),
   say so and what was left behind.

## Notes

- **Order is enforced**: commit → review-and-repair → open/resume → merge →
  cleanup → reset. A failure before the open step leaves committed local work and
  no PR; a failure after it leaves the PR in a safe, open state. Either way it is
  reported.
- **One push, after the review** — on the fresh path the branch is pushed exactly
  once, when the PR is opened, so the pre-push hook runs once rather than at open
  time and again for every repair round. Reviewing local commits before the PR
  exists is what buys this — and the base merge the review does first stays local
  too while there is no PR, so it costs no extra push. (The resume path keeps its
  already-open PR and pushes repairs, and now the base merge, to it, as before.)
- **The review gates the merge** — this flow never silently merges over a verdict
  that reports unresolved blocking findings, and never merges an unreviewed head.
- **The base-current gate closes the long-check race** — after the PR is pushed,
  the flow resolves and fetches the exact base snapshot from the PR repository
  immediately before merging. If the base advanced during review or pre-push
  checks, `cross-agent-review` integrates it, pushes, and reviews the new head
  before the SHA-bound merge is retried. GitHub's effective rules must enforce
  strict base freshness, which atomically rejects any later race. Two refresh
  rounds bound externally induced retries; exhaustion leaves the PR open.
- **Repair belongs to `cross-agent-review`** — including the severity vocabulary
  (Blocker/Major ≡ [P0]/[P1] are blocking), the round budget, and the re-review
  of every changed head. This skill only reads the verdict it reports and
  decides whether to merge. `--repair-rounds` and `--passes` are forwarded, not
  interpreted.
- **The merged head is the reviewed head** — `cross-agent-review` reports a SHA
  it actually reviewed; this skill re-verifies it against the local head (and
  against the pushed head once the PR is open) and passes it to `squash-merge`,
  which binds the merge with GraphQL `expectedHeadOid`. GitHub then rejects the
  merge outright if any commit landed after the review, so an unreviewed commit
  can never be merged. (A message-only co-author strip keeps it: step 3 checks
  tree and merge-base identity, then re-pins `REVIEWED_SHA`.) The lone exception
  is an explicit `--merge-anyway` over a could-not-run verdict, where the bound
  head is a candidate that no review read — the merge is still pinned, but the
  reviewed-head guarantee is the thing the caller chose to waive.
- **Title and subject stay in sync automatically**: `squash-merge` defaults to
  the PR title that `open-pr` set, so a single title argument (or none) suffices
  for both.
- **Wrapped mechanics stay authoritative**: this skill coordinates, while
  `open-pr`, `cross-agent-review`, `squash-merge`, and `reset` retain ownership
  of their validation and external operations — including the post-merge cleanup,
  which lives in `squash-merge` because it must be gated on the merge landing.
- **Cleanup and reset are different steps.** `squash-merge` returns to the PR's
  *base* branch and deletes the merged branch, gated on the merge landing;
  `reset` then re-asserts the checkout on the *default* branch and reinstalls the
  hooks, knowing nothing about PRs and never deleting anything. The gated half
  cannot move into `reset` without losing its gate, which is why `reset` runs
  after rather than instead.
- **Cleanup never runs on an unmerged branch** — it is gated on GitHub reporting
  `MERGED` *and* on the base branch verifiably containing the merge commit, and
  it is skipped on a dirty worktree so in-progress work is never carried onto
  the base branch or stranded. In every case the branch survives and the reason
  is reported.
- **Invoke the wrapped skills, not the tools they call.** `squash-merge` is the
  clearest case: its cleanup and `--keep-branch` wrap the tool call rather than
  living inside the tool, so calling `squashMerge` directly still merges — it just
  skips the cleanup, and does so silently. The same holds for the review fallback
  chain and repair loop in `cross-agent-review`.
- Single-quote the title argument and use a quoted heredoc for the body (per
  `open-pr`) so the shell does not expand `$(...)`, backticks, or `$VAR`.
