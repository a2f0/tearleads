# Verification

For agent sessions, wrap verification and other noisy commands with the shared
output harness:

```sh
bun run agent:run --label checks -- bun run check:affected
bun run agent:run --label package -- bun run check:package @tearleads/api
bun run agent:run --label push -- bun run agent-tool branch push <reviewed-sha> --remote origin
bun run agent:logs <reported-log-path> --tail-lines 40 --max-bytes 4096
```

The harness, from the pinned `@a2f0/agent-tool`, keeps full stdout and stderr
in private local files, prints a compact receipt on success, and includes a
bounded excerpt on failure. Its exit status is the command's exit status. The
log reader returns bounded, sanitized excerpts; inspect those before requesting
more output. The harness receipt does not replace the verification reports
described below, which also prove Turbo task and artifact completeness.

`bun run check` and `bun run check:affected` use the same verification runner.
Each runs `build:packages` (SQLite, the client SDK, and the Electrobun devkit),
TypeScript, `check:fast`, and then the full or affected Turbo tests. Builds
finish before tests begin.

Rebuild the client SDK before its own tests: `scripts/distArtifacts.test.ts`
inspects `dist`, and a few tests import `@tearleads/client-sdk`. `turbo run test`
builds the SDK first; a bare `bun run test` in the package does not, because a
test script that rebuilt `dist` would delete it under other packages' tests
running alongside it in Turbo.

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

For `@tearleads/api` and `@tearleads/client-sdk`, this command runs
`build:runtime` (SQLite and the SDK), then the selected workspace's `test`
script. Other selections run `build:packages`, which also prepares the
Electrobun devkit. The focused API and SDK suites need no desktop toolchain.
Additional arguments go to that script as separate arguments, including patterns
with spaces. The API script tests both database backends (`memory` and
`sqlite`). Package mode does not run TypeScript, static checks, or browser E2E
tests; use `check:affected` or `check` for a handoff. Dependencies must already
be installed; the runner does not install tools or change the lockfile.

CI runs the same API and SDK tests through `runVerifiedTurbo.ts test` with a
workspace filter; Turbo builds their dependencies first. Prefer `check:package`
locally for its source-fingerprinted report and forwarded test arguments. To
narrow API tests, use `--test-name-pattern`; its runner always selects `src`
and runs both backends, regardless of an outer `API_DATABASE` value.

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

## Multi-party scenarios

[`packages/bob-and-alice`](../../packages/bob-and-alice/) checks keying behavior
end to end. Each device is a full `Tearleads` client with its own SQLite
database, talking over HTTP to the API served in-process from
`@tearleads/api/test-runtime`. A reference model of grants, parent pointers,
group memberships, and document links decides who should read and write each
document, and every scenario compares each device's reads with it.

Add a scenario when a change can alter who reads or writes a document:
sharing, group membership, revocation, moves, links, key rotation, or reading
from a fresh install. Run them with
`bun run check:package @tearleads/bob-and-alice`. The package's Turbo test task
depends on `@tearleads/api#sources`, so an API change misses its cache.
Pin a reproducible open bug in `knownIssues.test.ts` as `test.failing`. See
the [package README](../../packages/bob-and-alice/README.md).

## Prerequisites

Use a Git checkout with a known base (`origin/main` by default), not a source
archive without `.git`. Verification uses Git to locate the repository, compare
OpenAPI changes, and record source fingerprints. Fetch `origin/main` before
base-sensitive checks, or set `OPENAPI_BASE_REF` to the intended comparison ref.

Review `.mise.toml`, then run `mise trust` in this checkout before `mise install`.
Trust is path-specific: a fresh clone or Scope workspace can require a separate
review. Do not disable trust globally to work around a shell startup error.

| Command | Prerequisites beyond the checkout |
| --- | --- |
| `check:package @tearleads/api` or `check:package @tearleads/client-sdk` | Pinned Bun, `bun install --frozen-lockfile`, and the SQLite download tools below. No Electrobun devkit, protocol-model, OpenAPI-compatibility, or Ruby lint gate runs in these focused checks. |
| `check:fast` | Installed dependencies and pinned mise tools, including Java/TLA+, oasdiff, ShellCheck and Ruby; run `bundle install` in [`packages/app-capacitor`](../../packages/app-capacitor/) for Ruby lint dependencies. Prepares the Electrobun devkit and SDK declarations. |
| `check`, `check:affected`, or pre-push | The static-gate prerequisites plus package builds, TypeScript, and the selected test suites; browser E2E also requires the Playwright browsers. |

`build:runtime` downloads the pinned SQLite WASM archive when uncached and
builds the SDK. Have `curl`, `unzip`, a SHA-256 utility, and network access for
uncached downloads. `build:packages` also prepares the Electrobun devkit; see the
[desktop setup guide](../../packages/app-electrobun/README.md) for supported
platforms and devkit cache/offline behavior. The separate SDK `package:smoke`
command installs a consumer's dependencies from npm. The SDK test suite's
packaging tests build and inspect local output without that install; with
dependencies and SQLite artifacts cached, focused SDK tests need no npm access.
Other workspaces can add their own test
prerequisites; check their README and `test` script.

For a checkout whose mise configuration cannot be trusted, the protocol and
OpenAPI checks accept the explicit pinned-tool paths documented in
[AGENTS.md](../../AGENTS.md). This supplies tools without changing trust state.

## Before a push

The push gate runs its checks in order and stops at the first failure, so a
mistake caught late still costs every check queued ahead of it. Two cheap
checks are worth running by hand rather than discovering minutes into a push:

- `bun tsc --build --pretty false` after any type or signature change. It is
  **not** part of `check:fast`; pre-push, `check:affected`, and `check` run it.
- `bun run lint:architecture` after adding or moving an `import`. A cycle is
  easy to create by importing a shared symbol back from a module that already
  imports you; extract the symbol into its own module instead.
  dependency-cruiser's `no-circular` rule covers package source; Biome's
  `noImportCycles` (with type-only imports counted) covers every file it checks,
  including [`scripts/`](../../scripts/), so `bun run lint:biome` reports one
  there too.

Before a push, prefer `bun run check:fast` over a hand-picked subset. It covers
the static half of the gate in a few minutes; sampling a few of its checks
individually is how a gate failure gets discovered late in a long push.
