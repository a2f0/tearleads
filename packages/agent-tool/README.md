# @tearleads/agent-tool

Minimal CLI for cross-agent code review. It solicits a review of the current
PR from a local coding-agent CLI (`claude` or `codex`), so one agent can request
a second opinion from another.

## Usage

```bash
bun packages/agent-tool/src/index.ts solicitClaudeCodeReview
bun packages/agent-tool/src/index.ts solicitCodexReview
```

Both actions:

1. Resolve the open PR for the current branch from git + `gh`.
2. Verify there are changes against the PR base branch.
3. Hand the diff to the target agent's CLI and stream its review to stdout.

The exit code is the reviewing CLI's exit code, so callers can fall back to
another reviewer on failure. This package backs the `cross-agent-review` skill
in `.claude/skills/` and `.codex/skills/`.

## Prerequisites

- `git` and `gh` (authenticated) on `PATH`.
- `claude` CLI authenticated for `solicitClaudeCodeReview`.
- `codex` CLI configured (`OPENAI_API_KEY`) for `solicitCodexReview`.
- An open PR on the current branch.
