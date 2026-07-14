---
name: squash-merge
description: Squash-merge the current PR with a subject-only commit message, validated against the repo's commitlint rules
---

# Squash Merge

Squash-merge the open PR for the current branch with a **subject-only** commit
message — no auto-generated body, commit list, or extended message. The subject
is validated against the repository's own commitlint configuration before the
merge runs.

## Arguments

- First argument (optional): the squash commit subject. When omitted, the PR
  title is used. Pass it as a single quoted argument, e.g.
  `"feat(app): add widget"`.

## Prerequisites

- `git` and `gh` (authenticated) on `PATH`.
- The `@tearleads/agent-tool` package: `packages/agent-tool/src/index.ts`.
- `node_modules` installed (`bun install`) so the commitlint CLI is available.
- An open, mergeable PR on the current branch.

## Setup

```bash
ROOT_DIR=$(git rev-parse --show-toplevel)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
AGENT_TOOL="$ROOT_DIR/packages/agent-tool/src/index.ts"
[ -f "$AGENT_TOOL" ] || { echo "Error: agent-tool not found at $AGENT_TOOL" >&2; exit 1; }
```

If `$BRANCH` is `main`, report the error and stop.

## Workflow

1. **Determine the subject**: If the user supplied a subject, use it verbatim.
   Otherwise the tool falls back to the PR title. Do not compose a body or
   extended message — the squash commit is the subject line only.

2. **Run the squash merge**:

   ```bash
   bun "$AGENT_TOOL" squashMerge 'feat(app): add widget'
   # or, to default to the PR title:
   bun "$AGENT_TOOL" squashMerge
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
   - Validates the subject with the repo's commitlint setup (the same
     `@commitlint/cli` binary and `commitlint.config.mts` the commit-msg hook
     uses) — conventional-commit syntax and the 50-character header limit are
     enforced identically. If validation fails it prints commitlint's report and
     exits non-zero **without merging**.
   - Runs `gh pr merge --squash --subject <subject> --body ""`, then confirms
     the PR reached the `MERGED` state (a merge queue can otherwise exit 0 while
     only queuing the PR).

3. **On a validation failure**: relay commitlint's output, propose a corrected
   subject that satisfies the rules (valid type, ≤50 chars), and re-run with the
   corrected subject once confirmed.

4. **Report results**: state the merged PR number, the final squash subject, and
   confirm the merge succeeded.

## Notes

- The commit message is the subject only; no `--body` content is added, and
  multi-line subjects are rejected.
- Validation runs before the merge, so an invalid subject never reaches GitHub.
- Always single-quote the subject argument to avoid shell expansion.
- A non-zero exit after `gh pr merge` means the PR did not actually merge (e.g.
  it was queued or blocked); do not report success in that case.
- The tool does not delete the branch; delete it separately if desired.
