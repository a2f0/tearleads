# Tearleads

Tearleads is an encrypted workspace with web, mobile, and desktop applications,
a client SDK, and an API for synchronizing documents and shared containers.
This repo is available on the web at <https://tearleads.com>.

- Web app: <https://app.tearleads.com>
- Two-pane demo of the app: <https://demo.tearleads.com>
- API: <https://api.tearleads.com>

## Quick start

Install [mise](https://mise.jdx.dev/) (for example with `brew install mise`).
It provides Bun and the other tools pinned in `.mise.toml`.

```sh
mise trust                       # after reviewing .mise.toml
mise install
bun install --frozen-lockfile
bun run build:packages           # SQLite, the client SDK, and the Electrobun devkit
sh scripts/git/install-hooks.sh  # commit-msg, pre-commit, and pre-push hooks
bun run --filter=@tearleads/api dev  # API at http://127.0.0.1:3001
bun run --filter=app-web dev         # in a second shell: web app at http://localhost:3000
```

Trust is specific to the checkout path, so a new clone or evaluation workspace
needs its own reviewed trust step. Existing clones follow the
[one-time hook migration](docs/developer/static-analysis.md#ci-and-the-push-gate)
instead of a fresh hook install. The API keeps its data in memory by default;
`sh scripts/dev/runApi.sh --help` lists its Postgres, SQLite, and Turso modes.

To invoke repository launchers and release shortcuts by name, source
`scripts/dev/session.sh` from the checkout. For a persistent shell shortcut:

```sh
tl() { . /path/to/checkout/scripts/dev/session.sh /path/to/checkout; } && tl
```

## Layout

| Path | Contents |
| --- | --- |
| `packages/app` | React application shell, mini-apps, and product UI |
| `packages/app-web` | Web app build and hosting |
| [`packages/app-capacitor`](packages/app-capacitor/README.md) | iOS and Android app and store releases |
| [`packages/app-electrobun`](packages/app-electrobun/README.md) | Desktop app and desktop releases |
| [`packages/website`](packages/website/README.md) | Marketing site at tearleads.com |
| [`packages/client-sdk`](packages/client-sdk/README.md) | React-free client runtime, published to npm |
| [`packages/windowing`](packages/windowing/README.md) | Window management for React, published to npm |
| `packages/api`, `packages/api-shared`, `packages/api-client` | HTTP API, its persistence layer, and the typed API client |
| [`packages/api-cli`](packages/api-cli/README.md) | API migration and operations CLI |
| `packages/ui` | Product-neutral UI shared by the website and app |
| `packages/crypto`, `packages/encoding`, `packages/validators` | Cryptography, encoding, and validation support |
| `packages/sqlite-instance`, `packages/sqlite-worker` | SQLite WASM build and worker runtime |
| [`packages/diagnostics`](packages/diagnostics/README.md), [`packages/loro`](packages/loro/README.md) | Error diagnostics and Loro build support |
| [`packages/bob-and-alice`](packages/bob-and-alice/README.md), [`packages/test-utils`](packages/test-utils/README.md) | Multi-party keying scenarios and shared test helpers |
| [`packages/performance`](packages/performance/README.md) | SDK and database performance experiments |
| [`formal`](formal/README.md) | TLA+ protocol models |
| [`scripts`](scripts/README.md) | Repository scripts, grouped by purpose |
| `terraform` | Infrastructure stacks and modules |
| [`docs`](docs/README.md) | Design references and developer guides |

## Tests and checks

```sh
# Build packages, then run every workspace's tests sequentially
bun run test:bun

# Run Bun workspace tests through Turborepo
bun run test:turbo:bun

# Run Bun workspace tests and the web E2E suite through Turborepo
bun run test:turbo

# Run only affected workspace and E2E tests through Turborepo
bun run test:turbo:affected

# Run a specific test
bun test packages/bob-and-alice/src/bobAndAlice.test.ts
```

`bun run check:fast` runs the static gates, `bun run check:affected` adds
TypeScript and the affected tests, and `bun run check` runs the full suite. The
static gates include a Ruby lint, so run `bundle install` from
`packages/app-capacitor` first. The pre-push hook runs the static gates,
Terraform checks, TypeScript, and the affected tests. The
[verification guide](docs/developer/verification.md#prerequisites) lists each
command's prerequisites.

## Bun catalogs

Shared dependency versions for workspace packages live in the root
[`package.json`](./package.json) under `catalog` and `catalogs`.
Workspace packages reference those versions with `catalog:` and
`catalog:<name>` so common versions stay aligned across the monorepo.

## Turborepo

[`turbo.json`](./turbo.json) adds dependency-aware task orchestration and
caching on top of the Bun workspace. The `test` task depends on the `build`
task of each workspace dependency, so their generated artifacts are refreshed
before tests run. CI shares the cache through the GitHub Actions cache; a task
that reads files outside its package declares them in that package's
`turbo.json`.

## Deployments and releases

Run `scripts/deploy/deployStaging.sh` or
`scripts/deploy/deployProduction.sh` for a complete tier deployment.
The [infrastructure guide](docs/developer/infrastructure.md) describes the
resources, secrets layout, deployment order, verification, and teardown policy.
Native store releases use the [Capacitor release guide](packages/app-capacitor/README.md#releases);
desktop releases use the [Electrobun guide](packages/app-electrobun/README.md).
Merging a version bump of `packages/client-sdk` or `packages/windowing` to
`main` publishes it to npm. See the [script index](scripts/README.md) for
commands grouped by purpose.

## Developer docs

The [documentation index](./docs/README.md) lists every design reference and
developer guide. Common starting points:

- [Verification](./docs/developer/verification.md)
- [Static analysis](./docs/developer/static-analysis.md)
- [CI and merge requirements](./docs/developer/ci-merge-gate.md)
- [Infrastructure and deployment](./docs/developer/infrastructure.md)
- [Dependency maintenance](./docs/dependency-upgrades.md)
- [Client SDK](./docs/developer/client-sdk.md)
- [Security guarantees](./docs/security-guarantees.md)
