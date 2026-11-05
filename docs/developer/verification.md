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

Rebuild the [client SDK](client-sdk.md) before its own tests:
`scripts/distArtifacts.test.ts` inspects `dist`, and a few tests import
`@tearleads/client-sdk`. `turbo run test` builds the SDK first; a bare
`bun run test` in the package does not, because a test script that rebuilt
`dist` would delete it under other packages' tests running alongside it in
Turbo.

The Turbo test and E2E scripts first record the planned tasks, then require a
fresh run summary proving every planned task succeeded, by execution or from
cache. Turbo can exit zero after interruption, so an exit code alone is
insufficient. Missing, incomplete or stale evidence fails verification.
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
with spaces. The API script tests both
[database backends](api-persistence.md#database) (`memory` and `sqlite`).
Package mode does not run TypeScript, static checks, or browser E2E tests; use
`check:affected` or `check` for a handoff. Dependencies must already be
installed; the runner does not install tools or change the lockfile.

[CI](ci-merge-gate.md) runs the same API and SDK tests through
`runVerifiedTurbo.ts test` with a workspace filter; Turbo builds their
dependencies first. Prefer `check:package` locally for its source-fingerprinted
report and forwarded test arguments. To narrow API tests, use
`--test-name-pattern`; its runner always selects `src` and runs both backends,
regardless of an outer `API_DATABASE` value.

Each run prints the path to a JSON report under the checkout's Git directory:
`git rev-parse --git-path verification` locates the report directory, including
in linked worktrees. Reports record the mode, package, starting and ending Git
commit/tree IDs, working-tree status and content fingerprints, commands, step
durations, exit codes, and skipped steps after a failure. Dirty worktrees are
supported and identified in the report. A changed revision or source fingerprint
fails the run, even when all commands succeeded.

Reports are saved before and after each step. An abruptly killed process leaves
a `running` report rather than a successful result. Each run has its own file,
and reports are local evidence, not a replacement for CI. Avoid editing
source or running concurrent builds/tests while a verification run is active:
the SDK build replaces output that dependent tests consume.

## Turbo task inputs

CI shares Turbo's cache through the GitHub Actions cache, and a hit replays a
pass without running the task. A hash covers the package's files, its
`dependsOn` tasks, the lockfile, `globalDependencies`, and `CI_TOOLCHAIN`. A
task reading anything else must say so in its package `turbo.json`: a
`$TURBO_ROOT$` input for a repository file, or `<package>#sources` in
`dependsOn` for another workspace's source. Depend on
`<package>#runtime-sources` instead when the task runs that package's code but
never its test files: it hashes everything except `*.test.ts(x)`, so a
test-only change keeps the dependent's cache. `build` leaves tests out of its
hash for the same reason. The nightly `Uncached tests` workflow catches a
missed input.

## Multi-party scenarios

[`packages/bob-and-alice`](../../packages/bob-and-alice/) checks
[keying](../keying-design.md) behavior end to end. Each device is a full
`Tearleads` client with its own SQLite database, talking over HTTP to the API
served in-process from `@tearleads/api/test-runtime`. A reference model of
[grants](../glossary.md#grant), parent pointers, group memberships, and
[document links](../document-link-and-sync-protocol.md) decides who should read
and write each [document](../glossary.md#document), and every scenario compares
each device's reads with it.

Add a scenario when a change can alter who reads or writes a document:
sharing, group membership, revocation, moves, links,
[key rotation](../glossary.md#rotate), or reading from a fresh install. Run them
with `bun run check:package @tearleads/bob-and-alice`. The package's Turbo test
task depends on `@tearleads/api#runtime-sources`, so an API source change
misses its cache and an API test-only change does not.
Pin a reproducible open bug in `knownIssues.test.ts` as `test.failing`. See
the [package README](../../packages/bob-and-alice/README.md).

## Prerequisites

Use a Git checkout with a known base (`origin/main` by default), not a source
archive without `.git`. Verification uses Git to locate the repository, compare
OpenAPI changes, and record source fingerprints. Fetch `origin/main` before
base-sensitive checks, or set `OPENAPI_BASE_REF` to the intended comparison ref.

Review `.mise.toml`, then run `mise trust` in this checkout before `mise install`.
Trust is path-specific: a fresh clone or [Scope](scope.md) workspace can require
a separate review. Do not disable trust globally to work around a shell startup
error.

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
Other workspaces can add their own test prerequisites; check their README and
`test` script.

For a checkout whose mise configuration cannot be trusted, the
[protocol](../../formal/README.md) and OpenAPI checks accept the explicit
[pinned-tool paths](#pinned-tools). This supplies tools without changing trust
state.

### Pinned tools

OpenAPI compatibility, protocol-model, and infrastructure checks use mise-pinned
tooling. After cloning, run:

```sh
mise install java github:oasdiff/oasdiff github:tlaplus/tlaplus
```

When local mise configuration cannot be trusted, the check scripts accept
`OASDIFF_BIN`, `JAVA_BIN`, and `TLA_TOOLS_ROOT` as explicit paths; point them
at the versions pinned in `.mise.toml`. For native Ruby gems on macOS, also
verify `command -v clang`: Lean's tool directory can shadow Xcode's compiler.
Select the compiler returned by `xcrun --find clang` and set `SDKROOT` from
`xcrun --sdk macosx --show-sdk-path` in the child environment. A scratch
compile does not replace `bundle install` and `bundle check` with isolated gem
paths and the existing frozen/deployment settings. Ruby's explicit source-build
setting matches the source archives recorded in `mise.lock`; do not silently
substitute prebuilt Ruby artifacts. CI uses mise. The protocol-model check
validates the pinned Java version and the TLA+ jar digest from
[`scripts/checks/tlaToolsPin.sh`](../../scripts/checks/tlaToolsPin.sh) on every
run, either way. The OpenAPI check validates the reported oasdiff version for
`OASDIFF_BIN`; use only a trusted binary at that path. These direct checks do
not depend on Turbo's task cache.

Fetch `origin/main`, or set `OPENAPI_BASE_REF` to check OpenAPI against another
base commit.

## Before a push

The [push gate](static-analysis.md#ci-and-the-push-gate) runs its checks in
order and stops at the first failure, so a late-caught mistake still costs every
check queued ahead of it. Run two cheap checks by hand rather than discovering
their failures minutes into a push:

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
the static half of the gate in a few minutes; sampling its checks individually
lets a gate failure surface late in a long push.
