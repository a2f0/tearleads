# Claude Code Notes

## Issue Tracking

When the user requests a change or new feature:

1. **Check for existing issue**: Search for a related open issue first
2. **Create an issue if none exists**: Before starting work, create a GitHub issue to track the request
3. **Reference the issue**: Include `Closes #<issue>` in the PR description body to auto-close the issue when merged. To close multiple issues, you can list them (e.g., `Closes #123, #456`).

```bash
# Create an issue for the user's request
gh issue create --title "feat: <brief description>" --body "## Description
<what the user requested>

## Tasks
- [ ] Implementation task 1
- [ ] Implementation task 2
"
```

Skip issue creation for:

- Trivial fixes (typos, formatting)
- Questions or research tasks
- Tasks that are part of an existing issue/PR

## Commit Guidelines

- Do NOT add co-author lines to commits (no "Co-Authored-By: Claude" or similar)
- Do NOT add "Generated with Claude Code" footers to commit messages
- Do NOT force push unless explicitly instructed to do so.
- Do NOT use `--no-verify` to bypass git hooks.
- Do NOT commit or push to the `main` branch, if you are on `main`, create a new branch.
- Do NOT use `any` typings or `as` TypesScript assertions.
- Do NOT decrease code coverage thresholds; always write tests for new code.

## PR Guidelines

- Do NOT add "Generated with Claude Code" footers to PR descriptions
