# @tearleads/agent-tool

Minimal CLI for cross-agent code review and PR squash-merges.

## Cross-agent review

Solicits a review of the current PR from a local coding-agent CLI (`claude` or
`codex`), so one agent can request a second opinion from another.

```bash
bun packages/agent-tool/src/index.ts solicitClaudeCodeReview        # effort: xhigh
bun packages/agent-tool/src/index.ts solicitCodexReview             # effort: high
# Override the reasoning effort (low | medium | high | xhigh | max):
bun packages/agent-tool/src/index.ts solicitCodexReview xhigh
```

Both actions:

1. Resolve the open PR for the current branch from git + `gh`.
2. Verify there are changes against the PR base branch.
3. Hand the diff to the target agent's CLI and stream its review to stdout.

The optional effort argument sets the reviewer's reasoning effort, defaulting to
**`xhigh` for Claude** and **`high` for Codex**. It is passed as
`claude --effort <level>` and `codex -c model_reasoning_effort="<level>"`, always
explicitly — so a Codex review never silently inherits `~/.codex/config.toml`.
An unknown level throws before the reviewer CLI is launched.

The exit code is the reviewing CLI's exit code, so callers can fall back to
another reviewer on failure. Backs the `cross-agent-review` skill in
`.claude/skills/` and `.codex/skills/`.

## Open a PR

Opens a pull request for the current branch with a **commitlint-conforming
title**.

```bash
# Explicit title, body piped via stdin:
bun packages/agent-tool/src/index.ts openPr 'feat(app): add widget' <<'EOF'
## Summary
What changed and why.
EOF
# Or omit the title to default to the branch's latest commit subject:
bun packages/agent-tool/src/index.ts openPr </dev/null
```

The title is validated with the repository's commitlint setup (see below) before
the PR is created, so conventional-commit syntax and the 50-char header limit
apply. The body is read from stdin (empty when none is piped), the head is the
current branch, and the base defaults to the repository's default branch. Errors
if an open PR already exists for the branch. Backs the `open-pr` skill.

## Squash merge

Squash-merges the current PR with a **subject-only** commit message — no
auto-generated body or extended message.

```bash
# Explicit subject:
bun packages/agent-tool/src/index.ts squashMerge "feat(app): add widget"
# Or omit to default to the PR title:
bun packages/agent-tool/src/index.ts squashMerge
```

The subject is validated against the repository's own commitlint setup (the same
`@commitlint/cli` binary and `commitlint.config.mts` the commit-msg hook uses),
so conventional-commit syntax and the 50-char header limit are enforced
identically. On success it runs `gh pr merge --squash --subject <subject>
--body ""`. Backs the `squash-merge` skill.

## Ship (open/resume → review → repair → merge)

The `ship-pr` skill opens or resumes a PR, reviews its exact pushed head, repairs
blocking findings in up to two rounds by default, re-reviews every changed head,
then squash-merges only the accepted reviewed commit. It adds no new CLI action;
it orchestrates the `open-pr`, `cross-agent-review`, and `squash-merge` skills.
See `.claude/skills/ship-pr/` and `.codex/skills/ship-pr/`.

## Prerequisites

- `git` and `gh` (authenticated) on `PATH`.
- `claude` CLI authenticated for `solicitClaudeCodeReview`.
- `codex` CLI configured (`OPENAI_API_KEY`) for `solicitCodexReview`.
- An open PR on the current branch.
