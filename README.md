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
the same bundle. Realtime events share each tier's API hostname at `/events`.

## Infrastructure Lifecycle

Terraform provisions each tier's persistent resources and Wrangler publishes
its Workers. Neither migrates retired deployment names or Terraform resource
addresses. Retire old resources using their owning configuration and state
before fresh provisioning. Preserve any needed data offline, and never discard
state for live resources or point a populated stack at an empty backend.

Each tier is four Cloudflare Workers plus three independent Terraform stacks:

- `packages/api` deploys `tearleads-platform-api-<tier>`: the Hono API, two
  SQLite Durable Objects (the session and ticket key/value store that replaced
  Redis, and the realtime hub that owns every WebSocket), and the Cron Triggers
  that run blob garbage collection hourly and billing maintenance every minute.
  A placement hint keeps it near PlanetScale Postgres in `us-east-1`, because
  registration performs many sequential database queries inside one
  transaction and cross-region round trips exceed Cloudflare's response
  timeout even though the write commits.
- `packages/app-web` deploys `tearleads-app-<tier>` and `tearleads-demo-<tier>`
  as Workers Static Assets, and `packages/website` deploys the marketing site.
- `terraform/stacks/<tier>/postgres` owns the tier's PlanetScale Postgres and
  Hyperdrive configuration,
  `terraform/stacks/<tier>/storage` its R2 blob bucket and API credentials,
  and `terraform/stacks/<tier>/edge` the custom domains that attach the API,
  app, and demo hostnames to the published Workers. The website keeps its own
  domain stack.

`scripts/deployStaging.sh` and `scripts/deployProduction.sh` run the whole
sequence: storage, database, API migrations and Worker, app bundles, edge
hostnames (which need the Workers to exist), API verification, then website. `packages/api/scripts/deployApi.sh`
migrates with the PlanetScale migration login, syncs the Worker secrets from
the Terraform outputs and `.secrets/<tier>.env`, and publishes with the build
constants from `packages/api/scripts/workerDefines.ts`. The document sync
cursor HMAC key is generated once per tier into `.secrets/<tier>.worker.env`.
`scripts/destroyStaging.sh` removes every staging resource; production stacks
refuse destruction through their wrappers.

The Worker connects through its `HYPERDRIVE` binding. The Postgres stack
configures Hyperdrive with the runtime login, PlanetScale's pooled port 6432,
TLS with WebPKI certificate validation, and query caching disabled. Fresh reads
are required for sync cursors, access epochs, and session revocation. The
Cloudflare deployment token needs Hyperdrive Edit.

The API deploy reads `hyperdrive_id` from Terraform and fills the selected
environment's binding in a temporary Wrangler configuration beside
`packages/api/wrangler.jsonc`. It removes the temporary file on exit and removes
old database secrets from the Worker. Only the deploy host receives the
migration login, which connects directly on port 5432. Run the tier deployment
scripts to resolve the binding; a bare `wrangler deploy` has no configuration ID.

`POSTGRES_REQUEST_SCOPED` still gives each request its own four-connection pool:
Workers cannot share sockets across requests, even through Hyperdrive. The pool
closes when the request finishes; Hyperdrive retains the origin connections.
The 30 s idle timeout allows reuse during a long request.
`POSTGRES_COALESCE_WRITES` gathers each query's protocol messages into one
socket write. `maxUses=1` remains
only for the fallback pool used by Durable Object timers, whose sockets must
not survive a checkout. The `local` Wrangler environment keeps the direct
Postgres transport for workerd tests. Deployed environments require Hyperdrive.

Keep the `aws:us-east-1` placement hint until measurements from multiple client
regions justify Smart Placement. Hyperdrive removes connection setup costs;
registration still issues many sequential queries, so its query latency still
depends on placement. Smart Placement needs sustained traffic from multiple
locations to learn a placement; a single deployment smoke cannot establish it.

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

- [API Persistence](./docs/developer/api-persistence.md)
- [Client SDK](./docs/developer/client-sdk.md)
- [Dependency Maintenance](./docs/dependency-upgrades.md)
- [Payment Provider MCP and CLI Operations](./docs/developer/payment-provider-mcp.md)
- [Realtime Hint Privacy](./docs/developer/realtime-hints.md)
- [RevenueCat Billing](./docs/developer/revenuecat-billing.md)
- [RevenueCat Native Stores](./docs/developer/revenuecat-native-stores.md)
- [Stripe Checkout Client](./docs/developer/stripe-checkout-client.md)
