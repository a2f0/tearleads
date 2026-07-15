---
name: cross-agent-review
description: Review the current PR with another AI agent (Claude Code by default, or a fresh Codex self-review) and repair blocking findings in bounded rounds
---

# Cross-Agent Review

Review the current PR with another AI agent, then repair the blocking findings it
raises. Invoked from Codex, this solicits a review from Claude Code by default,
or a fresh Codex self-review. Falls back to an in-session review when no external
agent is available.

This skill owns the full **review → repair → re-review** loop and the severity
gate that drives it. Repairs are bounded by `--repair-rounds` (default `2`); each
round changes the branch once and is followed by a fresh review of the new head,
so the reported head is always a head that was itself reviewed. Pass
`--repair-rounds 0` for a report-only review that changes nothing.

## Arguments

- First argument (optional): `claude` or `codex`. Defaults to `claude` (the
  other agent when invoked from Codex).
- Second argument (optional): the reviewer's reasoning **effort level** — one of
  `low`, `medium`, `high`, `xhigh`, `max`. When omitted it defaults **per agent**:
  **`xhigh` for Claude**, **`high` for Codex**. An unknown level fails fast
  before the reviewer CLI is launched.

  The level is passed as `claude --effort <level>` and, for Codex, as
  `-c model_reasoning_effort="<level>"` — an explicit override, so a Codex review
  never silently inherits whatever `~/.codex/config.toml` sets.
- `--passes <n>` (optional flag, position-independent): how many review passes to
  run over **one unchanged head**. **Defaults to `1`**. Passes buy discovery
  depth on a single diff; they never fix anything. A flag rather than a third
  positional argument, so it can be given without also supplying the agent and
  effort.
- `--repair-rounds <n>` (optional flag, position-independent): maximum
  blocking-finding repair rounds. **Defaults to `2`**. Each round may change the
  branch once and therefore requires a fresh review of the new head. **Use `0`
  for a report-only review** — findings are surfaced and nothing is touched.

`--passes` and `--repair-rounds` are different axes: passes re-read the same
commit, repair rounds produce new commits to read.

## Prerequisites

- `git` and `gh` (authenticated) on `PATH`.
- The `@tearleads/agent-tool` package: `packages/agent-tool/src/index.ts`.
- For Claude Code reviews: `claude` CLI authenticated.
- For Codex reviews: `codex` CLI configured (`OPENAI_API_KEY`).
- An open PR on the current branch, with local `HEAD` equal to the pushed PR
  head.
- Unless `--repair-rounds 0` is given: the worktree contains only changes
  intended for this PR, since repair rounds stage and commit from it.

## Setup

Resolve the branch, repo, PR, and tool path:

```bash
ROOT_DIR=$(git rev-parse --show-toplevel)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
PR_NUMBER=$(gh pr list --head "$BRANCH" --state open --json number --jq '.[0].number' -R "$REPO" 2>/dev/null || echo "")
AGENT_TOOL="$ROOT_DIR/packages/agent-tool/src/index.ts"
[ -f "$AGENT_TOOL" ] || { echo "Error: agent-tool not found at $AGENT_TOOL" >&2; exit 1; }
```

If `$BRANCH` is `main` or `$PR_NUMBER` is empty, report the error and stop.

## Workflow

1. **Determine agent and initialize the loop**: Parse the argument:
   - `codex` → Codex (self-review)
   - otherwise → Claude Code (default for Codex invoking this skill)

   Then set `REPAIR_ROUND=0`. **This happens once, here — never inside the loop.**
   Steps 2–5 form a loop that re-enters at step 2, so a counter initialized there
   would reset on every repair, the `--repair-rounds` bound would never advance,
   and the loop could commit and push without limit.

2. **Snapshot the candidate head**: For each head entering review, snapshot it
   and confirm it is the pushed PR head:

   ```bash
   REVIEWED_SHA=$(git rev-parse HEAD)
   test "$REVIEWED_SHA" = "$(gh pr view "$PR_NUMBER" --json headRefOid -q .headRefOid)"
   ```

   Reviewing a head that is not pushed reviews a diff no one else can see, and
   the resulting SHA cannot be handed to a merge. Stop if it does not match.

3. **Run the review**: Execute the matching action over the snapshot head. Omit
   the effort argument to take the per-agent default (`xhigh` for Claude, `high`
   for Codex); pass a level to override it.

   With `--passes <n>` and `n > 1`, repeat the review over the *same, unchanged*
   head, reporting only findings the earlier passes did not surface, and stop
   early as soon as a pass adds nothing new.

   **For Claude Code review:**

   ```bash
   bun "$AGENT_TOOL" solicitClaudeCodeReview       # effort: xhigh (default)
   bun "$AGENT_TOOL" solicitClaudeCodeReview high  # explicit override
   ```

   **For Codex review:**

   ```bash
   bun "$AGENT_TOOL" solicitCodexReview            # effort: high (default)
   bun "$AGENT_TOOL" solicitCodexReview xhigh      # explicit override
   ```

   **Fallback behavior (required):**

   - If the Claude Code review fails for **any** reason (credit/quota errors,
     non-zero exit, signal termination, or **no usable review** — see below),
     immediately fall back to a Codex self-review:

     ```bash
     bun "$AGENT_TOOL" solicitCodexReview
     ```

   - If the Codex review also fails (or was selected first and fails due to
     credits/quota/auth or prompt-size limits), perform an **in-session
     file-by-file review** (step 4).

   - Only stop immediately for non-recoverable operational errors (missing PR,
     missing tool script, malformed args) where fallback would also fail.

   - If every agent and fallback fails, report that the review **could not run**
     and stop. Never repair against a review that does not exist.

   **What counts as a usable review:** a reviewer CLI can exit **0** having
   produced only an intent sentence — "I'll review this PR diff..." — which is not
   a review. Never relay one as if it were, and never repair from one.

   Every **Claude** review ends with a `VERDICT:` line (`BLOCKER`, `MAJOR`,
   `MINOR`, or `CLEAN`), because this repo writes that prompt.
   `solicitClaudeCodeReview` checks for it and exits nonzero when it is absent, so
   the fallback above fires on its own.

   **Codex reviews carry no verdict line** — `codex review` builds its own prompt
   and this repo has no seam to add one, so absence of a verdict says nothing
   there. Judge a Codex review by reading it.

   After review, confirm the head is still the snapshot:

   ```bash
   test "$REVIEWED_SHA" = "$(git rev-parse HEAD)"
   test "$REVIEWED_SHA" = "$(gh pr view "$PR_NUMBER" --json headRefOid -q .headRefOid)"
   ```

   If either changed, something landed underneath the review. Discard the stale
   result, reconcile safely, and return to step 2 with the new pushed head. This
   check runs *before* any repair of this round, so it detects foreign pushes
   rather than the skill's own.

4. **In-session file-by-file review** (when external agents are unavailable):

   **CRITICAL: Never compute the full PR diff in a single pass.** Large diffs
   exceed prompt limits and cause partial/failed reviews. Interrogate GitHub and
   review file-by-file:

   a. Get the base ref and changed files:

      ```bash
      gh pr view "$PR_NUMBER" --json baseRefName,files -R "$REPO"
      ```

   b. For each changed file, get the per-file diff:

      ```bash
      git diff <baseRefName>...HEAD -- <file-path>
      ```

   c. For added or modified files, read the file with native file-reading tools
      for full context. Deleted files do not need to be read.

   d. Review each file against the project's guidelines (`REVIEW.md` if present,
      otherwise `AGENTS.md`):
      - Flag security issues, type safety violations, and missing tests as high
        priority.
      - Use severity levels: Blocker, Major, Minor, Suggestion.
      - Be concise: one line per issue with a `file:line` reference.

   e. Aggregate findings across all files into the final review output.

5. **Review gate and bounded repair**: read the findings and classify them.
   Reviewers use different severity vocabularies: the in-session fallback uses
   **Blocker / Major / Minor / Suggestion**, while Codex's native `codex review`
   uses **[P0]–[P3]**. Treat them as one scale — **Blocker ≡ [P0]**,
   **Major ≡ [P1]**, **Minor ≡ [P2]**, **Suggestion ≡ [P3]** — where
   **Blocker/Major (P0/P1) count as blocking**.

   - If the review is **clean or raises only non-blocking nits**
     (**Minor/Suggestion** or **[P2]/[P3]**), the loop is done. `REVIEWED_SHA` is
     the final reviewed head.
   - If the review raises a **blocking** finding, surface it. Then:
     - If `--repair-rounds 0` was given, **stop and report** the findings without
       touching the branch. This is the report-only mode.
     - If `REPAIR_ROUND` has reached `--repair-rounds`, **stop and report** the
       unresolved findings along with the rounds already performed.
     - Otherwise repair:
       1. Confirm each fix is actionable, in scope, and requires no new authority
          or material user choice. Stop and ask for direction when that is false.
       2. Implement all blocking fixes. Also address directly adjacent
          non-blocking findings when doing so is low-risk and avoids dead code or
          vacuous tests; do not expand the PR into unrelated cleanup.
       3. Run validation proportionate to the changes, including the repository's
          staged source-shape check before committing.
       4. Stage only the repair paths, commit with a valid conventional subject,
          and push without force. Stop if unrelated changes are mixed into the
          worktree.
       5. Increment `REPAIR_ROUND` — never reset it — and return to **step 2**,
          not step 1, so the new head is snapshotted and the **complete** PR diff
          is reviewed again while the round count survives.

   **Never report a head as reviewed after fixing it.** Every repair round ends by
   re-entering the loop; the reported `REVIEWED_SHA` is always a head that a
   review actually read.

6. **Report results**: Output
   - Which agent performed the review (and whether fallback was used, and why)
   - The PR number and branch
   - The review findings from the final review
   - **The head SHA** — normally `REVIEWED_SHA`, a head a review actually read.
     On a **review-could-not-run** verdict nothing was reviewed, so report the
     **candidate** head snapshotted in step 2 and label it plainly as
     *unreviewed*. Always report a SHA: a caller overriding the gate still needs
     a head to bind its merge to, and inventing one later would defeat the bind.
   - **The final verdict** — clean, non-blocking nits only, unresolved blocking
     findings, or review-could-not-run
   - **Repair rounds performed**, and what was fixed in them

   Callers gate on the last three. `ship-pr` binds its merge to the reported SHA
   and refuses to merge on an unresolved-blocking or could-not-run verdict unless
   it was told to override.

## Notes

- **Repairs are bounded** — at most two branch-changing repair rounds by default.
  The bound is what keeps a review → fix → re-review cycle from running away and
  surfacing ever-narrower findings; it is the reason this loop can be safe to own
  here at all. `--repair-rounds 0` disables repair entirely and restores the
  report-only review.
- **`--passes` and `--repair-rounds` are orthogonal.** `--passes` controls
  discovery depth on one unchanged head and never mutates anything;
  `--repair-rounds` bounds how many times the branch may change and be
  re-reviewed. Raising passes makes each look deeper; raising repair rounds makes
  the loop longer.
- **The reported head is a reviewed head.** `REVIEWED_SHA` is snapshotted before
  the review, verified unchanged after it, and re-snapshotted after every repair
  round. A caller that merges the reported SHA merges a commit that was reviewed.
- **A failed review is not a clean review.** If every agent and fallback fails,
  the verdict is *could-not-run* and no repair happens — repairing against absent
  findings would be inventing work.
- Effort defaults are per agent — `xhigh` for Claude, `high` for Codex — and are
  always passed explicitly, so neither reviewer inherits an ambient config value.
  Fallback reviews use the fallback agent's own default unless a level is given.
- The fallback chain is not a second pass: falling back to another agent (or the
  in-session review) is still the *same* single pass, because the first reviewer
  produced no usable result.
- The review scripts are non-interactive and stream output to stdout.
- Reviews are based on the diff between the PR's base branch and HEAD.
- The Claude review streams the prompt/diff via stdin (not argv) to avoid
  "Argument list too long" failures on large PRs.
- The Claude reviewer runs with read-only tools (`--tools "Read,Grep,Glob"`) and
  no `Bash`. It needs to read: the best findings come from the code *around* the
  diff — an unchanged branch further up the file, a source-shape baseline, the
  callers a signature change breaks. `Bash` is withheld because a review needs no
  shell, and the session's context is a PR diff — attacker-influenceable text.
  The repair rounds run in *this* session, not the reviewer's; the reviewer stays
  read-only no matter how many rounds run.
- **Why a review can come back empty is not known.** The one observed failure —
  Claude exiting 0 after ~5s having emitted only "I'll review this PR diff..." —
  was never reproduced and looks stochastic. The verdict check is what makes it
  survivable; it detects the failure rather than preventing it.
- Error output should be relayed verbatim when fallback is impossible.
