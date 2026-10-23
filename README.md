# Tearleads

Tearleads is an encrypted workspace with web, mobile, and desktop applications,
a client SDK, and an API for synchronizing documents and shared containers.

## Getting Started

1. Install `mise` with `brew install mise`, then run `mise install`.
2. Run `bun install --frozen-lockfile`.
3. Run `bundle install` from `packages/app-capacitor` for native release checks.
4. Run `bun run build:packages` to build SQLite and the SDK and prepare Electrobun.
5. Run `sh scripts/git/install-hooks.sh` to install Git hooks.
6. Run `bun run --filter=@tearleads/api dev` to start the API.
7. Run `bun run --filter=app-web dev` to start the web app.

To invoke repository launchers and release shortcuts by name, source
`scripts/dev/session.sh` from the checkout. For a persistent shell shortcut:

```sh
tl() { . /path/to/checkout/scripts/dev/session.sh /path/to/checkout; }
```

## Deployments and releases

Run `scripts/deploy/deployStaging.sh` or
`scripts/deploy/deployProduction.sh` for a complete tier deployment.
The [infrastructure guide](docs/developer/infrastructure.md) describes the
resources, secrets layout, deployment order, verification, and teardown policy.
Native store releases use the [Capacitor release guide](packages/app-capacitor/README.md);
desktop releases use the [Electrobun guide](packages/app-electrobun/README.md).
See the [script index](scripts/README.md) for commands grouped by purpose.

## Running Tests

```sh
# Run all Bun tests across workspace packages, sequentially
bun run test:bun

# Run Bun workspace tests through Turborepo
bun run test:turbo:bun

# Run all Turborepo test tasks
bun run test:turbo

# Run only changed/impacted Bun workspace tests through Turborepo
bun run test:turbo:affected

# Run a specific test
bun test packages/bob-and-alice/src/bobAndAlice.test.ts
```

## Bun Catalogs

Shared dependency versions for workspace packages live in the root
[`package.json`](./package.json) under `catalog` and `catalogs`.
Workspace packages reference those versions with `catalog:` and
`catalog:<name>` so common versions stay aligned across the monorepo.

## Turborepo

[`turbo.json`](./turbo.json) adds dependency-aware task orchestration and
caching on top of the Bun workspace. The `test` task depends on each
package's `build` task, so generated artifacts are refreshed before tests run.
CI shares the cache through the GitHub Actions cache; a task that reads files
outside its package declares them in that package's `turbo.json`.

## Developer Docs

- [Verification](./docs/developer/verification.md)
- [Static Analysis](./docs/developer/static-analysis.md)
- [CI and Merge Requirements](./docs/developer/ci-merge-gate.md)
- [Infrastructure and Deployment](./docs/developer/infrastructure.md)
- [API Persistence](./docs/developer/api-persistence.md)
- [Client SDK](./docs/developer/client-sdk.md)
- [Dependency Maintenance](./docs/dependency-upgrades.md)
- [Payment Provider MCP and CLI Operations](./docs/developer/payment-provider-mcp.md)
- [Realtime Hint Privacy](./docs/developer/realtime-hints.md)
- [RevenueCat Billing](./docs/developer/revenuecat-billing.md)
- [RevenueCat Native Stores](./docs/developer/revenuecat-native-stores.md)
- [Stripe Checkout Client](./docs/developer/stripe-checkout-client.md)
