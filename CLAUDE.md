# Agent Notes (Claude Code + Codex)

This file is shared by Claude Code and Codex. `AGENTS.md` is symlinked to this file.

## Repository Identification (CRITICAL)

**Never infer the repository name from the workspace folder name.** Workspaces like `rapid2`, `rapid10`, `rapid-main` are all clones of the same repository.

To get the correct repo for `gh` commands:

```bash
# Get the repo in owner/name format
gh repo view --json nameWithOwner -q .nameWithOwner
```

Always use `--repo` or `-R` flag with `gh` commands when the repo might be ambiguous:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
gh issue list -R "$REPO"
gh pr view 123 -R "$REPO"
```

## Issue Tracking

When the user requests a change or new feature:

1. **Check for existing issue**: Search for a related open issue first
2. **Create an issue if none exists**: Before starting work, create a GitHub issue to track the request
3. **Reference the issue**: Include `Closes #<issue>` in the PR description body to auto-close the issue when merged. To close multiple issues, you can list them (e.g., `Closes #123, #456`).

```bash
# Create an issue for the user's request (rewrite in your own words; add context)
cat <<'EOF' | gh issue create --title "feat: <brief description>" --body-file -
## Summary
<one paragraph describing the user goal and outcome in your own words>

## Context
<why this matters, impacted area, or constraints mentioned by the user>

## Requirements
- [ ] <clear, testable requirement 1>
- [ ] <clear, testable requirement 2>

## Implementation Notes
<initial approach, dependencies, or questions to resolve>
EOF
```

Issue-writing guidelines:

- Do not paste the user request verbatim; rewrite and organize it.
- Prefer clear, testable requirements over vague tasks.
- Add relevant context (impact, affected users, scope, constraints, examples).

Issue update guidelines:

- Avoid verbose comment threading; prefer updating the issue description with new info.
- If comments are needed, batch updates into larger chunks (milestones, decisions, blockers).

Skip issue creation for:

- Trivial fixes (typos, formatting)
- Questions or research tasks
- Tasks that are part of an existing issue/PR

## Commit Guidelines

### Format

- Use conventional commits: `<type>(<scope>): <description>` (max 50 chars subject)
- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`, `build`
- Scope: prefer feature-based (`pwa`, `auth`, `settings`) over package-based
- Description in imperative mood ("add" not "added")
- GPG signing required with 5s timeout: `printf "message" | timeout 5 git commit -S -F -`

### Do NOT

- Add co-author lines (no "Co-Authored-By: Claude" or similar)
- Add "Generated with Claude Code" footers
- Force push unless explicitly instructed
- Use `--no-verify` to bypass git hooks
- Commit or push to `main` branch; create a new branch instead
- Use `any` typings or `as` TypeScript assertions
- Decrease code coverage thresholds; always write tests for new code
- Commit binary files (PNG, JPG, ICO, etc.); use SVG or external URLs
- Add comments that restate what code does; only comment non-obvious logic

### Coverage Failures

- If CI or local runs fail coverage thresholds, add tests to raise coverage and re-run the relevant `test:coverage` target locally before proceeding.

## PR Guidelines

- Do NOT add "Generated with Claude Code" footers to PR descriptions

## Token Efficiency (CRITICAL)

Git hooks (husky pre-commit, pre-push) run linting, type-checking, builds, and tests that produce thousands of lines of stdout. **This output burns tokens and provides no value on success.**

### MANDATORY: Suppress stdout on ALL git operations

```bash
# ALWAYS redirect stdout to /dev/null
git commit -S -m "message" >/dev/null
git push >/dev/null
git push --force-with-lease >/dev/null

# NEVER run git commit/push without suppression
git commit -m "message"          # WRONG - wastes tokens
git push                         # WRONG - wastes tokens
git push --force-with-lease      # WRONG - wastes tokens
```

### Why this matters

- Pre-push hooks can output 5,000+ lines (lint results, test output, build logs)
- Each line consumes tokens from the context window
- On success, only the exit code matters - stdout is noise
- On failure, errors appear on stderr (preserved by `>/dev/null`)

### Other token-saving practices

- **Use `--json` with minimal fields**: `gh pr view --json state,mergeStateStatus` not `gh pr view`
- **Cache immutable data**: Store PR number, branch names, URLs from first fetch
- **Don't re-read files**: If you read a file once, don't read it again unless it changed
- **Batch related operations**: Combine status updates rather than outputting each individually

## Managing Claude Code Skills

The `.claude/commands/` folder contains reusable skills (slash commands). Each workspace uses its own `.claude` folder from the repo.

## PR Thread Replies (CRITICAL)

- **Always reply inside the review thread** when addressing Gemini or other reviewer feedback.
- **Never use top-level PR comments** (e.g., `gh pr comment`) to respond to review feedback.
- Use the PR review comment reply endpoint (`/pulls/comments/{comment_id}/replies`) to keep responses in-thread.
- Include the relevant commit message(s) in replies to Gemini.

### Adding, modifying, or deleting a skill

Skills are version-controlled like any other file. Create, edit, or delete files in `.claude/commands/` and commit as normal.

## Script Naming

- Use camelCase for npm script names (e.g., `buildOpenapi` not `build:openapi`)

## UI Guidelines

### Input Fields

- Use the shared `Input` component from `@/components/ui/input` for all form inputs
- Input fields must use `text-base` (16px) minimum font size to prevent iOS Safari auto-zoom on focus
- Never use `text-sm` or `text-xs` on input, textarea, or select elements

## React Guidelines

### Component Organization

- **One component per file** - Each React component must have its own file
- **Group by folder** - Group related components into folders. This is often by feature (e.g., `auth/`), but also useful for compound components (e.g., `context-menu/`)

  ```text
  src/
    features/
      auth/
        LoginForm.tsx
        LoginForm.test.tsx
    components/ui/
      context-menu/
        ContextMenu.tsx
        ContextMenu.test.tsx
        ContextMenuItem.tsx
        ContextMenuItem.test.tsx
        index.ts
  ```

- **Colocate tests** - Keep `.test.tsx` files next to their component files

### Refactoring

- **Keep test files in sync** - When renaming, moving, or deleting a component:
  - Rename/move/delete the corresponding `.test.tsx` file
  - Update any imports in the test file to reflect the new path
  - Ensure test file naming matches component file naming
