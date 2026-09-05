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

## Public Hostnames

Production uses `tearleads.com`, `app.tearleads.com`, `demo.tearleads.com`, and
`api.tearleads.com`. Staging uses `website-staging.tearleads.com`,
`app-staging.tearleads.com`, `demo-staging.tearleads.com`, and
`api-staging.tearleads.com`. The demo hosts serve the two-pane demo variant of
the same bundle, and `TF_VAR_extra_demo_domains` adds Cloudflare zones that
serve it too (for example `tearleads.de`, reached at `demo.tearleads.de`). Set
it in `.secrets/<tier>.env`, where Terraform, the server playbook, and the
app-web deploy all read it — quoted, since that file is sourced by bash:
`TF_VAR_extra_demo_domains='["tearleads.de"]'`. The Cloudflare token in
`TF_VAR_cloudflare_api_token` needs access to each listed zone. Realtime events
share each tier's API hostname at `/events`.

## Infrastructure Lifecycle

Terraform and Ansible provision and maintain current Tearleads deployments.
They do not migrate retired deployment names, services, directories, or
Terraform resource addresses. Replace retired hosts instead of running the
current playbook alongside their old services and maintenance timers.

Retire old resources using their owning configuration and state before fresh
provisioning. Preserve any needed data offline, and never discard state for
live resources or point a populated stack at an empty backend. Bootstrap the
current state bucket, provision the intended tier, and run its full Ansible
deployment. Current Tearleads resources with current state remain maintainable;
this does not require recreating them on every deploy.

Production retirement is still open as of the 2026-09-05 audit: its live
resources remain owned by `symcrypt-terraform-state`, while the production
server state in `tearleads-terraform-state` is empty. Do not use that empty
state to provision over the existing resources or deploy onto the unverified
production host. Retire them using their owning state before fresh provisioning;
remove this notice only after that retirement is verified.

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
