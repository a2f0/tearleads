---
name: open-pr
description: Open a PR for the current branch with a title that conforms to the repo's commitlint rules (e.g. fix(app): whatever)
---

# Open PR

Open a pull request for the current branch. The PR **title must conform to the
repository's commitlint rules** (conventional-commit syntax and the 50-char
header limit, e.g. `fix(app): whatever`); it is validated before the PR is
created.

## Arguments

- First argument (optional): the PR title. When omitted, the branch's latest
  commit subject is used. Pass it as a single quoted argument.
- The PR body is read from stdin (empty when none is piped).

## Prerequisites

- `git` and `gh` (authenticated) on `PATH`.
- The `@tearleads/agent-tool` package: `packages/agent-tool/src/index.ts`.
- `node_modules` installed (`bun install`) so the commitlint CLI is available.
- The current branch is **pushed to the remote** and has commits ahead of the
  base branch.
- No open PR already exists for the branch.

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

1. **Compose the title**: Write a conventional-commit title
   (`type(scope): description`, ≤50 chars). If the user gave a title, use it;
   otherwise the tool defaults to the branch's latest commit subject.

2. **Open the PR** (title single-quoted; body via a quoted heredoc):

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
   - Runs `gh pr create --title <title> --body <stdin> --head <branch>` (base
     defaults to the repository's default branch) and prints the PR URL.

3. **On a validation failure**: relay commitlint's output, propose a corrected
   title (valid type, ≤50 chars), and re-run once confirmed.

4. **Report results**: output the created PR URL and the final title.

## Notes

- The title obeys the same commitlint rules as commits, so it can later be
  reused verbatim as the squash-merge subject.
- Always single-quote the title and use a quoted heredoc for the body.
- The branch must already be pushed to the remote; this skill does not push.
- Base defaults to the repository's default branch.
