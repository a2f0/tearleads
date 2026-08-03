# Tearleads

## Getting Started

1. Install `mise` with `brew install mise`
2. Run `mise install`.
3. Run `bundle install` from `packages/app-capacitor` so the native release
   checks can run.
4. Run `source scripts/session.sh` to extend the path for scripts. Or,
   alternatively, add this to `~/.zshrc`:
   `tl() { . /path/to/checkout/scripts/session.sh /path/to/checkout; } && tl`
5. Run `buildSqliteMultipleCiphers.sh`.
6. Run `install-hooks.sh` to install Git hooks.
7. Run `bun run --filter=@tearleads/api dev` to start the API.
8. Run `bun run --filter=app-web dev` to start the dev server.

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
local caching on top of the Bun workspace. The `test` task depends on each
package's `build` task, so generated artifacts are refreshed before tests run.

## Developer Docs

- [API Persistence](./docs/developer/api-persistence.md)
- [Client SDK](./docs/developer/client-sdk.md)
- [Payment Provider MCP and CLI Operations](./docs/developer/payment-provider-mcp.md)
- [RevenueCat Billing](./docs/developer/revenuecat-billing.md)
- [RevenueCat Native Stores](./docs/developer/revenuecat-native-stores.md)
- [Stripe Checkout Client](./docs/developer/stripe-checkout-client.md)
