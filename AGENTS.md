# Multi-Agent Workflow Guide

## Output capture

Run Bun tests through `bun run agent-tool bun test --log [-- args...]`, and
other finite, noisy commands, such as installs, builds, linters, package
scripts, and Git commands that run hooks, through
`bun run agent:run --label <name> -- <command> [args...]`. Each keeps complete
output in a private log, preserves the exit status, and prints a compact
receipt, with a bounded excerpt of the log on failure. Read more with
`bun run agent:logs <log-path>`, raising `--tail-lines` or `--max-bytes` as
needed, or with a targeted search of the log. A zero exit does not rule out
warnings: inspect required warnings, timings, and artifacts before accepting a
check. Run reviews, version preparation, audits, infrastructure previews, and
run-group checks directly so their results stay visible, and run interactive
tools and servers directly too. Never narrow a suite or silence warnings to
reduce output.

Keep verification evidence visible: a receipt does not replace the per-run
reports in the [verification guide](docs/developer/verification.md).

## Preflight Commands

Before pushing, run `bun tsc --build --pretty false`; after import changes, run
`bun run lint:architecture`. See the
[cheap-check guidance](docs/developer/verification.md#before-a-push).

Run the smallest command that matches the handoff risk:

- `bun run check:fast`: formatting, OpenAPI generation and compatibility,
  bounded protocol models, package assertions, canonical ordering, Knip,
  architecture, file names, source shape, binary-file, ShellCheck, and Markdown
  checks.
- `bun run check:protocol-models`: all bounded TLC checks registered in
  `formal/protocol-models.txt`, using the Java and TLA+ tools pinned in
  `.mise.toml`. It and `bun run check:protocol-negative-controls` run two TLC
  processes at a time; set `PROTOCOL_TLC_PARALLELISM` to change that.
- `bun run check:protocol-traces` and `bun run check:protocol-projection`:
  the TLC trace fixture drift check and the implementation-trace projection
  (both also inside `check:fast`; both need the mise-pinned Java/TLA+ tools).
- `bun run check:affected`: `check:fast`, TypeScript, and affected Turbo tests.
- `bun run check`: `check:fast`, TypeScript, and the full Turbo test suite.
- `bun run check:package <workspace-name> [test arguments...]`: build SQLite and
  the SDK, then run workspace tests. Also prepares Electrobun except for API/SDK.
  Use `@tearleads/api`, `app`, or `@tearleads/client-sdk`.
  Focused tests do not replace static or TypeScript gates.
- `bun run lint:biome:promises`: builds the SDK's public declarations, then
  checks production promises in API, SDK, app, crypto, and diagnostics. In
  `lint:biome`, `check:fast`, and pre-push; its separate `biome.promises.jsonc`
  keeps type scanning out of formatting hooks.
- `bun run test:biome:promises`: builds SDK declarations and proves the promise
  gate resolves SDK calls through gitignored build output. Runs inside
  `lint:biome:promises`.
- `bun run lint:knip:production`: production-only dependency and source
  reachability.
- `bun run test:knip:production`: production entrypoint regression fixtures.
  Run `bun install` to apply the pinned dependency patch in `patches/`.
- `bun run test:architecture`: graph health and runtime dependency regression
  fixtures; included in `check:fast`.
- `bun run test:static-analysis`: Git snapshot, source-shape baseline, and
  ShellCheck inventory fixtures; included in `check:fast` and pre-push.
- `bun run lint:doc-links`: Markdown links, fragments, and linked code
  references (`-- --fix`, `-- --external`); see the `validate-docs` skill.
- `bun run lint:canonical-ordering`: bans `localeCompare` without a locale and
  `Intl.Collator` in hash-adjacent code (`packages/crypto/src`,
  `packages/client-sdk/src/data`); sort with `compareCanonicalStrings`.
- `bun run lint:scripts`: ShellCheck over tracked shell files and shell shebangs.
  See [static-analysis maintenance](docs/developer/static-analysis.md) for
  snapshot semantics and explicit script exceptions, and
  [dependency maintenance](docs/dependency-upgrades.md) for upgrade policy.
- `bun run report:dependencies:json`, `report:dependencies:mermaid`, and
  `report:dependencies:archi`: architecture diagnostics and graphs.

### Rebuild the SDK before trusting app or api tests

`packages/app` and `packages/api` resolve `@tearleads/client-sdk` from
`packages/client-sdk/dist`, so after editing SDK source their tests run against
the previous build. The app test preload refuses to start on a stale dist;
**`packages/api` has no such guard and passes against the old code.** Rebuild
with `bun run --filter='@tearleads/client-sdk' build` between an SDK edit and
any api test run, or treat the result as meaningless.

Prefer `bun run check:package @tearleads/api` for a focused API test run; it
handles that build prerequisite. It, `check`, and `check:affected` write
per-run JSON reports under `git rev-parse --git-path verification`, with
revision, working-tree fingerprints, step timings, and outcomes. A source or
revision change during the run fails verification.

### Declare what a Turbo task reads

CI shares Turbo's cache through the GitHub Actions cache, and a hit replays a
pass without running the task. A hash covers the package's files, its
`dependsOn` tasks, the lockfile, `globalDependencies`, and `CI_TOOLCHAIN`. A
task reading anything else must say so in its package `turbo.json`: a
`$TURBO_ROOT$` input for a repository file, or `<package>#sources` in
`dependsOn` for another workspace's source. The nightly `Uncached tests`
workflow catches a missed input.

### Prove a security test fails without its fix

A test written alongside a verifier change can pass for the wrong reason — the
input is rejected by an earlier guard, a fixture returns one shared value for
what should be distinct keys, or the assertion never reaches the branch. Before
relying on one, revert the fix, confirm the test fails, and restore it. The same
applies to a reviewer's claim: reproduce it before repairing, since a plausible
mechanism can still have a consequence the code does not actually exhibit.

Use `bun run lint:source-shape -- --staged` before committing, and
`bun run lint:source-shape -- --range <base>..<head>` before handing off a
larger branch.

The pre-push hook records every run's per-check timings in the Git directory.
`scripts/git/showPushGateTimings.sh` prints the last run (`--head <sha>` selects
the run that pushed a commit), so a slow or failed push can be inspected
without rerunning the gate.

OpenAPI compatibility, protocol-model, and infrastructure checks use mise-pinned
tooling. After cloning, run:

```sh
mise install java github:oasdiff/oasdiff github:tlaplus/tlaplus
```

When local mise configuration cannot be trusted, the check scripts accept
`OASDIFF_BIN`, `JAVA_BIN`, and `TLA_TOOLS_ROOT` as explicit paths; point them
at the versions pinned in `.mise.toml`. CI uses mise. The protocol-model check
validates the pinned Java version and the TLA+ jar digest from
`scripts/checks/tlaToolsPin.sh` on every run, either way. The OpenAPI check
validates the reported oasdiff version for `OASDIFF_BIN`; use only a trusted
binary at that path. These direct checks do not depend on Turbo's task cache.

Fetch `origin/main`, or set `OPENAPI_BASE_REF` to check OpenAPI against another
base commit.

After `bun install`, run `bun run --cwd packages/app-electrobun prepare:devkit`
before standalone TypeScript, Knip, or editor checks: Electrobun 2 generates the
SDK configuration they consume. `check:fast` and `build:packages` already do
this; see [desktop setup](packages/app-electrobun/README.md) for cache and
offline use.

Intentional flag-day OpenAPI breaks may temporarily list an exact oasdiff
diagnostic in `scripts/checks/openApiCompatibilityErrors.ignore`. Each entry
must name its issue and removal condition in adjacent comments, and must be
deleted as soon as the default branch contains the new contract.

## Ownership Lanes

- `packages/api`: HTTP routes, service facades, workflow orchestration, and
  server adapters.
- `packages/api-shared`: API persistence schema, migrations, and database
  adapters, shared with `packages/api-cli` (the migration and admin CLI).
- `packages/api-client`: typed API client and request/response boundary helpers.
- `packages/client-sdk`: React-free client runtime, local persistence, sync,
  workflow facades, and public SDK exports.
- `packages/app`: React application shell, providers, stores, mini-apps,
  document projections, and product UI.
- `packages/app-web`, `packages/app-capacitor`, and `packages/app-electrobun`:
  deployment targets. Do not turn these into reusable libraries.
- `packages/crypto`, `packages/diagnostics`, `packages/encoding`,
  `packages/loro`, `packages/sqlite-instance`, `packages/sqlite-worker`,
  `packages/validators`: lower-level support packages. Apps import these
  packages, never the reverse.
- `packages/test-utils` and `packages/bob-and-alice`: test support only.
  Production source must not depend on them.
- `packages/ui`: product-neutral shared UI used by the website and app.
- `packages/windowing`: app-agnostic window state, window chrome, and the
  menu and sidebar primitives it renders with, plus a launcher of mini-apps:
  its navigation (windowed or routed) and the routed shell. It is published to
  npm on its own, so it depends on no other workspace package; app behavior
  reaches a window or the routed shell through slots such as `Window`'s
  `ContentBoundary` and `RoutedPane`'s chrome props.
- `packages/website`: marketing/docs site. It may share UI, but must not import
  application implementation code.
- `packages/performance`: SDK/DB probes; no inbound imports or live CI runs.

## Dependency Direction

- API routes call services; services delegate transaction orchestration to
  workflows; workflows own access-plane composition.
- App presentation goes through stores/providers instead of importing
  persistence, SQLite, blob, contact, sync, or workflow internals directly.
- Client SDK data modules stay below client, store, and workflow facades.
- Client SDK components meet at named ports wired by the composition root and
  keep per-database or per-scope state in one `getOrCreate*` scoped singleton.
  Follow [client SDK seams](docs/developer/client-sdk-seams.md) and the
  `isolate-sdk-component` skill.
- `@tearleads/validators`, `@tearleads/diagnostics`, `@tearleads/encoding`,
  and `@tearleads/sqlite-instance` are leaf-level support packages.
- `@tearleads/api-shared` stays below `packages/api` and `packages/api-cli`,
  which do not import each other.
- `@tearleads/sqlite-worker` may depend on `@tearleads/sqlite-instance`, but not
  app, API, SDK, UI, or other support implementation code.
- `@tearleads/api-client` may share crypto and validator contracts, but must not
  import server, app, SDK, UI, or deployment implementation code.
- Production source must not import `@tearleads/test-utils` or
  `@tearleads/bob-and-alice`; keep shared test helpers in tests or documented
  test helper directories.
- Deployment target packages (`app-web`, `app-capacitor`, `app-electrobun`, and
  `website`) should consume shared packages and app facades, not import each
  other or become dependencies of reusable packages.
- Support packages must not import `packages/api`, `packages/app`,
  `packages/app-web`, `packages/app-capacitor`, `packages/app-electrobun`,
  `packages/client-sdk`, or `packages/website` implementation code unless an
  architecture rule explicitly allows it.
- Package-private source paths stay private unless they are exported in
  `package.json` and documented as public API.

## Subsystems

A **subsystem** is a stable proper noun for a slice of the system a developer
reasons about as one unit (e.g. `Containers`, `Realtime Sync`, `Access Plane &
Keying`). Use it in PRs and review to say where a feature lives and who owns it.

A subsystem indexes existing paths and may span layers (`Containers` covers its
routes, service facade, and workflows). Import direction stays enforced by the
lanes/layers/planes in `dependency-cruiser.config.ts`. A subsystem declaring a
`surface` (client SDK rows) is a boundary: other subsystems import only those
files. The registry is `scripts/architecture/subsystems.ts` plus
`docs/subsystems.md`; `bun run lint:architecture` fails if a file maps to zero or
several subsystems, manifest and docs drift, or an import skips a surface.
Registered: `packages/api`, `packages/client-sdk`, and `packages/app`.

### Boundary vocabulary axes

These are distinct axes — do not conflate them:

- **Lane** — a package (`packages/<name>/src`); the coarsest ownership boundary.
- **Layer** — an intra-package directional tier (api `routes -> services ->
  workflows -> access`; app/SDK `data -> workflows -> stores -> presentation`).
- **Plane** — the api access read/write/shared split; a domain model, not a tree
  layout (see `docs/api-architecture.md`).
- **Facade** — a package's stable public seam (api `services/`, SDK
  `workflows/`, the `read/*.ts` + `write/*.ts` files).
- **Subsystem** — a vertical (or platform) slice's proper noun, layered
  descriptively over the above.

### Overloaded nouns (same word, different layer per package)

Read these layer nouns by their package, not the bare word:

- **workflow** — api: the _low_ transaction-orchestration layer **below**
  services. client-sdk: the _top_ public domain-operations facade. Opposite ends
  of the two stacks; the name is kept on both by decision.
- **store** — app: a React/UI state container. client-sdk: a headless,
  React-free state machine. api `access`: a low-level persistence sink.
- **runtime** — api `ApiServiceRuntime`: an infrastructure-injection dependency
  object. client-sdk: live client state + the workflow context value. app
  `AppRuntimeProvider`: the React provider aggregate.

## Generated And Build Output

Do not edit generated or build output directly:

- `dist/`, `build/`, `.turbo/`, `.astro/`, `playwright-report/`, `test-results/`
- `tsconfig.tsbuildinfo`
- SQLite wasm artifacts produced by `packages/sqlite-instance/scripts/buildSqliteMultipleCiphers.sh`
- Generated migration output unless the task is explicitly about schema
  migration generation

## Coordination Rules

- Keep changes inside one ownership lane when possible. If a change crosses
  lanes, explain the dependency direction in the PR body.
- Prefer small source files and focused modules. New or modified files are
  checked by `scripts/checks/lintSourceShape.ts`.
- File-size, suppression, and approved barrel baselines live in
  `scripts/checks/sourceShapeBaseline.json`.
- Do not grow an over-limit file as an incidental edit. Split by behavior,
  storage concern, workflow step, or UI subcomponent. If an over-limit file
  intentionally grows, update its line/byte budget in
  `scripts/checks/sourceShapeBaseline.json` with reviewer context.
- Treat package root barrels and workflow facades as API policy. Add explicit
  named exports; new `export *` barrels must be added to the source-shape
  baseline intentionally.
- Do not add `biome-ignore`, `ts-ignore`, `ts-expect-error`, or TODO
  suppressions casually. The source-shape check tracks baseline growth.
- When changing public SDK exports, update `packages/client-sdk/package.json`,
  `packages/client-sdk/src/index.ts`,
  `packages/client-sdk/src/workflows/README.md`, and
  `docs/developer/client-sdk.md` together.
- When changing dependency topology, run `bun run lint:architecture` and inspect
  `bun run report:dependencies:json` if the failure is not obvious.
- When changing production dependencies, run both `bun run lint:knip:all` and
  `bun run lint:knip:production`.
- Skill documents (the Markdown under `.claude/skills` and `.agents/skills`)
  must not contain `$0` through `$9` or `$ARGUMENTS`, braced or not. Claude
  Code substitutes skill arguments into those tokens, so a snippet such as
  `awk '{ print $1 }'` reaches the agent corrupted whenever the skill is
  invoked with arguments, while the file on disk still looks correct. Use
  `cut`, `sed`, or named variables instead; these skills read their arguments
  from the appended argument block. Enforced by `bun run lint:skill-placeholders`
  in `check:fast`.

## Script And Documentation Layout

Follow the [script index](scripts/README.md) when adding or moving tooling.
Keep package-script names stable, and update callers, relative root resolution,
CI filters, tests, native build references, and Turbo inputs together. Helpers
belong beside the command group they serve; `scripts/lib` is for shared helpers.
Root README covers setup and normal usage. Detailed validation lives in the
[verification guide](docs/developer/verification.md), analysis policy in the
[static-analysis guide](docs/developer/static-analysis.md), and deployment policy
in the [infrastructure guide](docs/developer/infrastructure.md).

## Agent Tooling And Shipping

Shared branch, hook, validation, release, review, PR, and version helpers come
from the exact npm-pinned [`@a2f0/agent-tool`](https://github.com/a2f0/agent-tool)
dev dependency; run it with `bun run agent-tool`. Branch, commit trust, binary,
hook, title, required-check, base-freshness, and version policy is in
`agent-tool.json`. The shared `cross-agent-review`, `open-pr`, `squash-merge`,
`ship-pr`, `reset`, and `update-dependencies` skills are managed copies in
`.agents/skills` and `.claude/skills`, tracked by `.agent-tool-skills.json`. Do
not edit them; change the shared skill upstream instead. After changing the pin
or `agent-tool.json`, run `bun run agents:sync`, which also writes the [harness
permissions](docs/developer/static-analysis.md#harness-permissions), and commit
the lockfile, skills, rules, and manifests together. The Markdown linter skips
the exact managed skill paths, preserving their upstream formatting; project
skills follow local rules. `bun run agents:check`, part of `check:fast`, fails
on missing, outdated, or edited managed skills or rules. Project skills keep a
Claude copy in `.claude/skills` and a Codex copy in `.agents/skills`.

Shipping rules on top of the shared skills:

- **Reviewer**: prefer the other agent's CLI (Codex from Claude Code, Claude
  from Codex), then the remaining CLIs, and report any fallback.
- **Base integration**: merge the pinned base OID; never rebase or force-push.
  Without a PR, integrate and repair locally so the branch is pushed once.
- **Versions**: every changed workspace package ships one patch past its
  version on the merge base. After each base integration or repair and before
  each review, run `bun run agent-tool versions prepare "$BASE_OID"`, which
  commits the manifests and refreshed `bun.lock`. Resolve a conflict confined
  to version fields with `bun run agent-tool versions resolve-conflicts`, then
  `git commit --no-edit`. Before merging, `versions check` must pass against the
  live base.
- **Titles**: PR titles and squash subjects follow `commitlint.config.mts`. The
  helper checks type and length only, so also run
  `printf '%s\n' "$TITLE" | bun run agent-tool bun x commitlint -- --config commitlint.config.mts`.
  Check a new branch name with `bun run lint:branch-name <name>`. Pre-push
  lints each branch a push creates or updates, and CI's `Lint` job lints every
  pull request's branch. If a session starts on a nonconforming branch, move
  the work to a conforming branch before the first commit.
- **Push**: the pre-push gate takes over ten minutes, so run it in the
  background. It checks signatures and rejects `Co-authored-by` trailers on
  commits not already reachable from the push remote. A rewrite that only removes
  them needs no re-review if the tree and the merge base with the PR base are
  unchanged; re-pin the reviewed SHA to the rewritten head.
- **Branches**: create from the current base with
  `bun run agent-tool branch create <name> --base main --remote origin`. Push
  with `branch push <reviewed-sha> --remote origin` through
  [output capture](#output-capture); normal hooks remain mandatory.
- **Merge**: run
  `node_modules/.bin/agent-tool pr merge '' "$REVIEWED_SHA" "$BASE_REF"`
  directly, because `bun run` drops empty arguments. It requires the core
  checks in the [merge gate policy](docs/developer/ci-merge-gate.md) and a
  strict, non-bypassable `protect-main` ruleset. Never use `gh pr merge`.
- **Reset**: after returning to `main`, run `sh scripts/git/install-hooks.sh`
  so merged hook changes take effect. It installs only the tracked files
  declared in `agent-tool.json`; inspect existing hooks before the one-time
  `--adopt` migration described in the
  [static-analysis guide](docs/developer/static-analysis.md#ci-and-the-push-gate).
- **Report** the push gate cost with
  `scripts/git/showPushGateTimings.sh --head "$REVIEWED_SHA"` after the merge.
