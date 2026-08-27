# @symcrypt/agent-tool

Minimal CLI for cross-agent code review and PR squash-merges.

## Cross-agent review

Solicits a review of the current branch's diff from a local coding-agent CLI
(`claude` or `codex`), so one agent can request a second opinion from another. The
branch need not have a PR yet — with none open, the diff is taken against the
default branch.

```bash
bun packages/agent-tool/src/index.ts solicitClaudeCodeReview        # effort: xhigh
bun packages/agent-tool/src/index.ts solicitCodexReview             # effort: high
# Override the reasoning effort (low | medium | high | xhigh | max):
bun packages/agent-tool/src/index.ts solicitCodexReview xhigh
```

Both actions:

1. Resolve the review base from git + `gh` — the PR's base when the branch has an
   open PR, the repository's default branch when it does not.
2. Verify there are changes against that base.
3. Pin the base and head commit IDs once, then use those IDs for the review
   policy, diff, and temporary read-only snapshot before handing the prompt to
   the target agent's CLI on stdin.
4. Relay the review to stdout and gate it: a usable review carries a
   `VERDICT: BLOCKER|MAJOR|MINOR|SUGGESTION|CLEAN` line. An exit-0 run without
   one is retried once (the observed failure mode is stochastic), then reported
   as a nonzero exit.

The coordinating review skill pins its already-fetched base snapshot through
`AGENT_TOOL_REVIEW_BASE_OID`. Direct callers may set the same variable to a full
locally available Git OID; malformed or unavailable values fail before a
reviewer is launched. This prevents a later fetch or a fork's `origin` from
changing which base the review reads.

Without a pinned OID, the tool fetches the live base branch from the repository
that owns the PR. It does not treat the PR's reported base OID as the branch tip:
for a behind PR, that value can remain the older snapshot the PR is based on.

The diff forces every path to text and disables text conversion and external
diff drivers, so branch-controlled attributes cannot hide content or execute a
driver. The snapshot is materialized directly from the raw blobs in the pinned
head tree, bypassing branch-controlled export attributes and content filters.
Unsafe paths, symlinks that do not resolve through the committed virtual tree to
a regular file, and colliding destinations fail closed before any blob is
written. Destination validation includes an empty-tree probe on the actual
snapshot filesystem, covering platform-specific aliases beyond portable case
and Unicode normalization checks.
The snapshot contains no untracked files, local edits, or `.git` metadata and is
deleted after the review. Claude reviews that
snapshot with read-only tools (`Read,Grep,Glob`, no `Bash`) under an absolute
snapshot-scoped allow rule in safe and `dontAsk` modes, with browser integration
and session persistence disabled. Codex reviews via an ephemeral `codex exec`
session with the user config ignored. Its custom permission profile denies the
host filesystem and sandbox network by default, explicitly disables hosted web
search, grants read access only to the snapshot, the resolved Codex installation
directory, and minimal runtime paths, and strips the environment from
model-generated commands. Codex runs from a neutral temporary directory so the
branch's `AGENTS.md` is not injected as reviewer policy. Only its final message
— captured with `--output-last-message` — is relayed, so the output is the
review itself rather than the session's investigative transcript.

The optional effort argument sets the reviewer's reasoning effort, defaulting to
**`xhigh` for Claude** and **`high` for Codex**. It is passed as
`claude --effort <level>` and `codex exec -c model_reasoning_effort="<level>"`,
always explicitly — so a Codex review never silently inherits
`~/.codex/config.toml`. An unknown level throws before the reviewer CLI is
launched.

The exit code is the reviewing CLI's exit code (or `1` for a review that failed
the verdict gate), so callers can fall back to another reviewer on failure.
Backs the `cross-agent-review` skill in `.claude/skills/` and `.codex/skills/`.

These actions **only review**. The fallback chain, the severity gate, and the
bounded repair loop live in the `cross-agent-review` skill *around* these calls
— invoking the actions directly gets you one raw review and no repair.

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

The tool only merges. Returning to the base branch, fast-forwarding it, and
deleting the merged branch live in the `squash-merge` skill *around* this call —
as does its `--keep-branch` flag, which the tool does not accept. Invoking the
tool directly merges without any of that cleanup.

## Ship (commit → review → repair → open/resume → merge → reset)

The `ship-pr` skill commits the work on a feature branch, hands it to
`cross-agent-review` — which reviews the local commits (or the pushed head when
a PR is already open), repairs blocking findings in up to two rounds by default,
and re-reviews every head it changes — then opens or resumes the PR with a
single push and squash-merges only the reviewed commit that review reports back.
Opening the PR after the review is what keeps the branch to a single push
through the pre-push hook. It finishes by handing off to `reset`, which returns
the checkout to the default branch and reinstalls the repo's git hooks, so a
merged change under `scripts/git/hooks/` takes effect instead of sitting
uninstalled. It adds no new CLI action; it orchestrates the `open-pr`,
`cross-agent-review`, `squash-merge`, and `reset` skills. See
`.claude/skills/ship-pr/` and `.codex/skills/ship-pr/`.

Review and repair are one unit, owned by `cross-agent-review`; `ship-pr` keeps
only the merge gate (and `--merge-anyway` to override it). For a review that
changes nothing, invoke `cross-agent-review` with `--repair-rounds 0`.

## Prerequisites

- `git` and `gh` (authenticated) on `PATH`.
- `claude` CLI authenticated for `solicitClaudeCodeReview`.
- `codex` CLI configured (`OPENAI_API_KEY`) for `solicitCodexReview`.
- A PR on the current branch: `squashMerge` requires an open one; `openPr`
  requires that none exists; the review actions work with or without one (with
  none, they review against the default branch).
