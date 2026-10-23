# Verification

For agent sessions, wrap verification and other noisy commands with the shared
output harness:

```sh
bun run agent:run --label checks -- bun run check:affected
bun run agent:run --label package -- bun run check:package @tearleads/api
bun run agent:run --label push -- bun run agent-tool branch push <reviewed-sha> --remote origin
bun run agent:logs <reported-log-path> --tail-lines 40 --max-bytes 4096
```

The exact npm-pinned agent-tool release retains full stdout and stderr in private
local files, prints a compact receipt on success, and includes a bounded excerpt
on failure. Its exit status remains the command's exit status. The log reader
returns bounded, sanitized excerpts; inspect those before requesting more output.
Keep the existing verification reports below as evidence of completed gates.
They additionally prove Turbo task and artifact completeness, which the shared
process runner alone cannot establish.

`bun run check` and `bun run check:affected` use the same verification runner.
They retain their existing build, TypeScript, static-check, and full or affected
Turbo test steps. Builds finish before tests begin; `build:packages` prepares
SQLite, the client SDK, and the Electrobun devkit.

Rebuild the client SDK before its own tests: `distArtifacts.test.ts` inspects
`dist`, and a few tests import `@tearleads/client-sdk`. `turbo run test`
builds the SDK first; a bare `bun run test` in the package does not, because a
test script that rebuilt `dist` would delete it under other packages' tests
running alongside it in turbo.

The Turbo test and E2E scripts first record the planned tasks, then require a
fresh run summary proving that every planned task completed successfully, either
by execution or from cache. Turbo can exit zero after interruption; an exit code
alone is insufficient. Missing, incomplete or stale evidence fails verification.
Run summaries accumulate under `.turbo/runs` for inspection; remove that ignored
directory when the evidence is no longer needed.

For focused tests, select the exact workspace name from its `package.json`:

```sh
bun run check:package @tearleads/api
bun run check:package app --test-name-pattern 'folder recovery'
bun run check:package @tearleads/client-sdk
```

This command runs `build:packages`, then the selected workspace's `test` script.
Additional arguments go to that script as separate arguments, including patterns
with spaces. The API script still tests both database backends. Package mode
does not run TypeScript, static checks, or browser E2E tests; use `check:affected`
or `check` for a handoff. Dependencies must already be installed; the runner does
not install tools or change the lockfile.

Each run prints the path to a JSON report under the checkout's Git directory:
`git rev-parse --git-path verification` locates the report directory, including
in linked worktrees. Reports record the mode, package, starting and ending Git
commit/tree IDs, working-tree status and content fingerprints, commands, step
durations, exit codes, and skipped steps after a failure. Dirty worktrees are
supported and identified in the report. A changed revision or source fingerprint
fails the run, even when all commands succeeded.

Reports are saved before and after each step. An abruptly killed process leaves
a `running` report rather than a successful result. Each run has its own file,
and reports are local evidence rather than a replacement for CI. Avoid editing
source or running concurrent builds/tests while a verification run is active:
the SDK build replaces output that dependent tests consume.

## Before a push

The push gate runs its checks in order and stops at the first failure, so a
mistake in a fast check still costs everything queued ahead of it. Two are worth
running by hand rather than discovering ~8 minutes into a push:

- `bun tsc --build --pretty false` (about 7s) after any type or signature
  change. It is **not** part of `check:fast`; only `check:affected` and `check`
  include it.
- `bun run lint:architecture` (about 16s) after adding or moving an `import`.
  A cycle is easy to create by importing a shared symbol back from a module that
  already imports you; extract the symbol into its own module instead.

Before a push, prefer `bun run check:fast` over a hand-picked subset. It is about
six minutes and covers the static half of the gate; sampling a few of its checks
individually is how a gate failure gets discovered at the forty-minute mark.
