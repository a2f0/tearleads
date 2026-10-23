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

Deployment and release credentials live in `.secrets`, a gitignored link to
`../matrix-secrets/tearleads`. The a2f0/matrix repository manages and backs them
up; see its [`docs/secrets.md`](https://github.com/a2f0/matrix/blob/main/docs/secrets.md).
Each tier reads only `.secrets/staging/` or `.secrets/prod/`: `shared.env`, then
`app.env`, which wins. Commands without a tier use `prod`.

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

Every stack keeps its state in the Cloudflare R2 bucket
`tearleads-terraform-state`, at `<tier>/<stack>/terraform.tfstate`, through the
S3 backend with lockfile locking. The bucket was created by hand and no stack
manages it. The `terraform/scripts/run-*-stack.sh` wrappers hand Terraform the
tier's `TF_STATE_ACCESS_KEY_ID` and `TF_STATE_SECRET_ACCESS_KEY` from
`.secrets/<tier>/app.env` as `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`,
ignoring any AWS profile or session. That pair is the R2 S3 key of a token
limited to the state bucket: the token ID and the SHA-256 of the token value.
No stack uses the AWS provider.

State moved here from the AWS S3 bucket of the same name in October 2026. Every
object was copied under its existing key, and its lineage and serial were
verified, before the backends changed. The wrappers' `init -reconfigure`
therefore attaches each stack to its copied state without migrating anything.
The AWS bucket, its DynamoDB lock table, and the local bootstrap state are
retired; never initialize a stack against them.

`scripts/deployStaging.sh` and `scripts/deployProduction.sh` run the whole
sequence: storage, database, API migrations and Worker, app bundles, edge
hostnames (which need the Workers to exist), API verification, then website. `packages/api/scripts/deployApi.sh`
migrates with the PlanetScale migration login, syncs the Worker secrets from
the Terraform outputs and the `.secrets/<tier>/` env files, and publishes with
the build constants from `packages/api/scripts/workerDefines.ts`. The
document sync cursor HMAC key is generated once per tier into
`.secrets/<tier>/worker.env`.
`scripts/destroyStaging.sh` and `scripts/destroyProduction.sh` remove every
resource of their tier through `scripts/lib/destroyTier.sh`, timing each step.
The production script asks for the domain unless given `--auto-approve`; the
production teardown steps refuse to run outside it. The stack wrappers still
refuse a production `destroy`; the teardown applies saved destroy plans.

The deployed API allows browser requests from every origin (`API_CORS_ORIGINS=*`)
for SDK hosts, with explicit bearer-token and protocol headers and no cookie
credentials. Stripe checkout and portal return URLs use the independent
`API_BILLING_RETURN_ORIGINS` allowlist. Deployments derive it from the tier's app
and demo hosts plus native loopback origins; a tier setting replaces that list.
Wildcards are rejected for billing. Local servers default to unrestricted CORS
and no billing return origins; configure the billing list to use hosted checkout.

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
only for work outside an event scope, whose sockets must not survive a checkout.
The realtime hub now scopes its HTTP, RPC, WebSocket, and alarm events too,
closing their pools before it can hibernate. See
[realtime hub hibernation](docs/developer/realtime-hints.md#cloudflare-hub-hibernation).
The `local` Wrangler environment keeps the direct
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

- [Hosted Click Analytics](./docs/developer/click-tracking.md)
- [API Persistence](./docs/developer/api-persistence.md)
- [Client SDK](./docs/developer/client-sdk.md)
- [Dependency Maintenance](./docs/dependency-upgrades.md)
- [Payment Provider MCP and CLI Operations](./docs/developer/payment-provider-mcp.md)
- [Realtime Hint Privacy](./docs/developer/realtime-hints.md)
- [RevenueCat Billing](./docs/developer/revenuecat-billing.md)
- [RevenueCat Native Stores](./docs/developer/revenuecat-native-stores.md)
- [Stripe Checkout Client](./docs/developer/stripe-checkout-client.md)
