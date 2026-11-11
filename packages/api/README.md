# @tearleads/api

The Tearleads HTTP API: routes, services, transaction-scoped workflows, the
access plane, realtime events, billing, and the Cloudflare Worker that serves
it. Deployed tiers run the Worker entry
([`src/worker/index.ts`](src/worker/index.ts)) on Cloudflare
Workers, with PlanetScale Postgres through Hyperdrive and R2 for encrypted
blobs; [`src/index.ts`](src/index.ts) is the local Bun development server.

Persistence and the schema live in [`@tearleads/api-shared`](../api-shared/README.md),
and every route's request and response shapes in
[`@tearleads/validators`](../validators/README.md). The API and the
[operations CLI](../api-cli/README.md) never import each other.

## Layers

```text
routes -> services -> workflows -> access/read + access/write
```

| Path | Contents |
| --- | --- |
| [`src/routes`](src/routes/) | Route registrations for each operation contract |
| [`src/services`](src/services/) | Route-facing request, session, and runtime boundary |
| [`src/workflows`](src/workflows/README.md) | Transaction-scoped orchestration across access-plane reads and writes |
| [`src/access`](src/access/README.md) | Access-plane reads and writes |
| [`src/middleware`](src/middleware/), [`src/realtime`](src/realtime/) | Sessions and request lifetime; the server-events WebSocket gateway |
| [`src/billing`](src/billing/) | Stripe and RevenueCat billing |
| [`src/worker`](src/worker/) | Worker entry, Durable Objects, Cron Trigger maintenance, and maintenance mode |
| [`src/adapters`](src/adapters/) | S3 (R2) and in-memory blob stores, the key-value store, and pub/sub |

The [API architecture](../../docs/api-architecture.md) lists every route and
explains the protocol planes. The
[`docs/openapi.json`](../../docs/openapi.json) artifact is generated from the
operation contracts.

## Local development

```sh
bun run --filter=@tearleads/api dev   # http://127.0.0.1:3001, in-memory PGlite
sh scripts/dev/runApi.sh --help       # PGlite and Postgres modes
```

[API persistence](../../docs/developer/api-persistence.md) describes each
database mode and its environment variables.

## Deployment

[`scripts/deploy/deployStaging.sh`](../../scripts/deploy/deployStaging.sh) and
[`scripts/deploy/deployProduction.sh`][file-1] run
[`scripts/deployApi.sh`](scripts/deployApi.sh) for each tier: it builds the
Worker, uploads its source map to Sentry, runs migrations, syncs secrets, and
publishes. [`scripts/deployApiMaintenance.sh`](scripts/deployApiMaintenance.sh)
stops a tier's writers for a
greenfield reset. The [infrastructure guide](../../docs/developer/infrastructure.md)
covers the resources and deployment order, and the
[API Sentry guide](../../docs/developer/api-sentry.md) covers error reporting.

[`scripts/blobGc.ts`](scripts/blobGc.ts) and
[`scripts/stripeSeatSync.ts`](scripts/stripeSeatSync.ts) run the Worker's
scheduled maintenance on demand.

## Test runtime

`@tearleads/api/test-runtime` exports the route app, an in-memory blob store,
and session helpers, so other packages' tests ([bob-and-alice](../bob-and-alice/README.md),
the [CLI](../cli/README.md)) can serve a real API in-process. Production code
must not import it.

## Tests

```sh
bun run check:package @tearleads/api
```

That builds the client SDK first; the API's tests resolve it from
`packages/client-sdk/dist` and pass against a stale build. `bun run test` in
this package runs the suite on in-memory PGlite; the multi-connection races in
`*.pg.test.ts` run against a real server in the Postgres concurrency lane
(`bun run test:postgres-concurrency`).

[file-1]: ../../scripts/deploy/deployProduction.sh
