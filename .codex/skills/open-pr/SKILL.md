---
name: open-pr
description: "Prepare a branch from the updated default branch when needed, then open a PR with a title that conforms to the repo's commitlint rules (e.g. fix(app): whatever)"
---

# Open PR

Prepare a pull-request branch and open its PR. When invoked on the repository's
default branch, first preserve the intended work, fast-forward the default
branch from `origin`, create a feature branch, and restore the work there. The
PR **title must conform to the repository's commitlint rules**
(conventional-commit syntax and the 50-char header limit, e.g.
`fix(app): whatever`); it is validated before the PR is created.

## Arguments

- First argument (optional): the PR title. When omitted on an existing feature
  branch, the branch's latest commit subject is used. When starting with
  uncommitted work on the default branch, compose it from the task and reuse it
  for the primary commit and PR. Pass it as a single quoted argument.
- Branch name (optional): when starting on the default branch, use a supplied
  name or derive a concise `<type>/<kebab-slug>` name from the task or PR title.
- The PR body is read from stdin (empty when none is piped).

## Prerequisites

- `git`, `gh` (authenticated), and POSIX `awk` on `PATH`.
- The `@symcrypt/agent-tool` package: `packages/agent-tool/src/index.ts`.
- `node_modules` installed (`bun install`) so the commitlint CLI is available.
- The working tree contains only changes intended for this PR. Stop and ask
  before carrying unrelated changes onto a new branch or committing them.
- Before `openPr` runs, the feature branch must be pushed and have commits ahead
  of the base branch. The workflow below prepares this when necessary.
- No open PR already exists for the branch.

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

1. **Compose the title**: Write a conventional-commit title
   (`type(scope): description`, ≤50 chars). If the user supplied a title, use
   it. Otherwise, use the feature branch's latest commit subject when it
   describes the task; for uncommitted default-branch work, compose a title from
   the task before committing.

2. **Move default-branch work safely**: Skip this step when `$BRANCH` is already
   a feature branch. When `$BRANCH` equals `$DEFAULT_BRANCH`:

   - Derive or use a concise `<type>/<kebab-slug>` branch name, such as
     `fix/contacts-custom-org-loading`. Validate it before mutating Git state:

     ```bash
     git check-ref-format --branch "$NEW_BRANCH"
     bun run lint:branch-name "$NEW_BRANCH"
     ```

   - Inspect `git status --short` and the diff. Continue only when every local
     change belongs in the requested PR.
   - Fetch first, verify that local default has no unique/diverged commits, and
     ensure the new branch name does not already exist locally or on `origin`:

     ```bash
     git fetch origin "$DEFAULT_BRANCH"
     if ! git merge-base --is-ancestor HEAD "origin/$DEFAULT_BRANCH"; then
       echo "Error: local $DEFAULT_BRANCH has unique or diverged commits" >&2
       exit 1
     fi
     if git show-ref --verify --quiet "refs/heads/$NEW_BRANCH" ||
       git ls-remote --exit-code --heads origin "$NEW_BRANCH" >/dev/null; then
       echo "Error: branch already exists: $NEW_BRANCH" >&2
       exit 1
     fi
     ```

     If the ancestry check fails, stop rather than rebasing or resetting local
     default-branch commits.
   - If the tree is dirty, stash tracked, staged, and untracked work with a
     unique message, then record the exact stash OID. Ignored files are not
     carried:

     ```bash
     git stash push --include-untracked -m "open-pr: move work to $NEW_BRANCH"
     STASH_OID=$(git rev-parse "stash@{0}")
     ```

   - Fast-forward the local default branch and create the new branch:

     ```bash
     git merge --ff-only "origin/$DEFAULT_BRANCH"
     git switch -c "$NEW_BRANCH"
     BRANCH=$(git branch --show-current)
     ```

     If work was stashed, restore its saved index/worktree state:

     ```bash
     git stash apply --index "$STASH_OID"
     ```

     After a successful apply, resolve the recorded OID back to its current
     stash reference before dropping it (`git stash drop` does not accept a raw
     OID):

     ```bash
     STASH_REF=$(
       git stash list --format='%gd %H' |
         awk -v stash_oid="$STASH_OID" '$2 == stash_oid { print $1; exit }'
     )
     [ -n "$STASH_REF" ] || {
       echo "Error: restored stash OID is no longer in the stash list" >&2
       exit 1
     }
     git stash drop "$STASH_REF"
     ```

     Drop only the resolved entry, and only after a successful apply. If apply
     conflicts or fails, leave the stash intact, report the new branch plus
     `git status`, and stop for resolution. If the merge or branch creation
     fails after stashing, reapply that OID on the current branch and use the
     same OID-to-reference lookup before dropping it. Never use a hard reset,
     clean, forced branch creation, automatic rebase, or force push.

3. **Commit and push**: Run the repository's relevant preflight, review the
   final diff, stage only intended paths, and commit any uncommitted work with a
   valid conventional subject — and never with a `Co-authored-by` trailer,
   which the pre-push hook rejects. Use separate commits for distinct changes
   when useful. Confirm the branch has commits ahead of
   `origin/$DEFAULT_BRANCH`, then push without force:

   ```bash
   git push -u origin "$BRANCH"
   ```

   If the push is rejected and `checkCommitTrust`'s co-author check is the
   **only** failure, treat it as mechanical, not as a defect in the work:
   rewrite the offending commit message(s) to delete the `Co-authored-by`
   line(s) — `git commit --amend` for HEAD, a non-interactive reword for
   earlier commits — without touching any tree, then push again. Report the
   old and new head SHAs and state that the rewrite was message-only, so a
   caller such as `ship-pr` can keep treating the content as reviewed instead
   of triggering a re-review. Any other pre-push failure (missing signature,
   failing checks) keeps its normal handling: fix it or stop and report.

4. **Open the PR** (title single-quoted; body via a quoted heredoc):

   ```bash
   bun "$AGENT_TOOL" openPr 'feat(app): add widget' <<'EOF'
   ## Summary
   What changed and why.
   EOF
   ```

   To default the title to the latest commit subject, or to open with no body:

   ```bash
   bun "$AGENT_TOOL" openPr </dev/null
   ```

   **Quote the title in single quotes** and use a **quoted heredoc** (`<<'EOF'`)
   for the body so the shell does not expand `$(...)`, backticks, or `$VAR`
   before the tool sees them.

   The tool:
   - Resolves the current branch and repo, and errors if an open PR already
     exists for the branch.
   - Rejects a multi-line title.
   - Validates the title with the repo's commitlint setup (the same
     `@commitlint/cli` binary and `commitlint.config.mts` the commit-msg hook
     uses). If validation fails it prints commitlint's report and exits non-zero
     **without creating the PR**.
   - Rejects a body carrying Claude Code branding — the "Generated with Claude
     Code" attribution, its `claude.com/claude-code` or `claude.ai/code` links,
     or a Claude co-author trailer — and exits non-zero **without creating the
     PR**. This mirrors the pre-push hook that strips co-author trailers from
     commits: keep the attribution footer out of PR descriptions entirely.
   - Runs `gh pr create --title <title> --body <stdin> --head <branch>` (base
     defaults to the repository's default branch) and prints the PR URL.

5. **On a validation failure**: for a rejected title, relay commitlint's output,
   propose a corrected title (valid type, ≤50 chars), and re-run once confirmed.
   For a rejected body, remove the flagged Claude Code branding from the
   description and re-run — never re-add the attribution to satisfy it.

6. **Report results**: output the created PR URL and the final title.

## Notes

- The title obeys the same commitlint rules as commits, so it can later be
  reused verbatim as the squash-merge subject.
- Always single-quote the title and use a quoted heredoc for the body.
- Default-branch preparation carries untracked files but not ignored files.
- Never commit unrelated user changes or discard a stash after a failed restore.
- The body must not contain Claude Code branding; the tool rejects it before
  creating the PR, so write PR descriptions without any attribution footer.
- Base defaults to the repository's default branch.
