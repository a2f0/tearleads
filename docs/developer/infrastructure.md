# Infrastructure and deployment

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

Production web hosts are indexable, and the demo hosts' shell names the app
root as its canonical URL. Staging web hosts name no canonical URL and send
`X-Robots-Tag: noindex, nofollow` with a matching robots meta tag. The website
build adds these for `PUBLIC_ENVIRONMENT=staging` (see the
[website guide](../../packages/website/README.md#search-and-link-previews)).
`packages/app-web/scripts/deployAppWeb.sh` builds the app with `APP_WEB_TIER`,
which `scripts/injectTierMeta.ts` reads, then adds the header while staging
the assets and refuses a build whose tags do not match its tier.

Every proxied tearleads.com host, staging and continuity included, answers
`http://` with a 301 to `https://` before any Worker runs. That is the zone's
Always Use HTTPS setting, which the production website stack owns because it
is zone-wide. Every client, provider webhook, and billing return URL that
names a tearleads.com host uses `https://`.

## Infrastructure Lifecycle

Terraform provisions each tier's persistent resources and Wrangler publishes
its Workers. Neither migrates deployment names or Terraform resource
addresses: retire a resource through its owning configuration and state before
provisioning its replacement. Preserve any needed data offline, and never
discard state for live resources or point a populated stack at an empty
backend.

Each tier is four Cloudflare Workers plus independent Terraform stacks:

- `packages/api` deploys `tearleads-platform-api-<tier>`: the Hono API, two
  SQLite Durable Objects (`KeyValueStore`, which holds sessions and tickets,
  and `RealtimeHub`, which owns every WebSocket), and the Cron Triggers that
  run blob garbage collection hourly and billing maintenance every minute.
  A placement hint keeps it near PlanetScale Postgres in `us-east-1`, because
  registration performs many sequential database queries inside one
  transaction and cross-region round trips exceed Cloudflare's response
  timeout even though the write commits.
- `packages/app-web` deploys `tearleads-app-<tier>` and `tearleads-demo-<tier>`
  as Workers Static Assets, and `packages/website` deploys the marketing site.
- `terraform/stacks/<tier>/postgres` owns the tier's PlanetScale Postgres and
  Hyperdrive configuration, `terraform/stacks/<tier>/storage` its R2 blob
  bucket and API credentials, and `terraform/stacks/<tier>/edge` the custom
  domains that attach the API, app, and demo hostnames to the published
  Workers. `terraform/stacks/<tier>/downloads` owns the public desktop release
  bucket at `downloads.<domain>` or `downloads-staging.<domain>`, which desktop
  release publication fills. `terraform/stacks/<tier>/website` holds the
  website's domain; production's also turns on the zone's Always Use HTTPS,
  which needs Zone Settings Edit on its token. The provider's destroy only
  forgets that setting, so a teardown leaves it on. Production also has a
  `continuity` stack for the `continuity.<domain>` site, whose assets the
  a2f0/continuity repository publishes.

Every stack keeps its state in the Cloudflare R2 bucket
`tearleads-terraform-state`, at `<tier>/<stack>/terraform.tfstate`, through the
S3 backend with lockfile locking. The bucket was created by hand and no stack
manages it. The `terraform/scripts/run-*-stack.sh` wrappers hand Terraform the
tier's `TF_STATE_ACCESS_KEY_ID` and `TF_STATE_SECRET_ACCESS_KEY` from
`.secrets/<tier>/app.env` as `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`,
ignoring any AWS profile or session. That pair is the R2 S3 key of a token
limited to the state bucket: the token ID and the SHA-256 of the token value.
No stack uses the AWS provider.

`scripts/deploy/deployStaging.sh` and `scripts/deploy/deployProduction.sh` run
the whole sequence: storage, database, API migrations and Worker, app bundles,
edge hostnames (which need the Workers to exist), API verification, then
website. Staging applies its storage and Postgres stacks on every full deploy;
production only checks that they are already provisioned. `--skip-terraform`
skips every Terraform apply. `packages/api/scripts/deployApi.sh` migrates with
the PlanetScale migration login, syncs the Worker secrets from the Terraform
outputs and the `.secrets/<tier>/` env files, and publishes with the build
constants from `packages/api/scripts/workerDefines.ts`. The document sync
cursor HMAC key is generated once per tier into `.secrets/<tier>/worker.env`.

`scripts/deploy/destroyStaging.sh` and `scripts/deploy/destroyProduction.sh`
remove every resource of their tier, including the downloads bucket and the
website, through `scripts/deploy/destroyTier.sh`, timing each step. The
production script asks for the domain unless given `--auto-approve`; the
production teardown steps refuse to run outside it. The stack wrappers refuse
a production `destroy`; the teardown applies saved destroy plans.

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
`packages/api/wrangler.jsonc`, removed on exit. After publishing, it deletes
any Worker secret the deploy does not manage, so an integration disabled in the
tier's env file stays disabled. Only the deploy host receives the migration
login, which connects directly on port 5432. Run the tier deployment scripts to
resolve the binding; a bare `wrangler deploy` has no configuration ID.

`POSTGRES_REQUEST_SCOPED` gives each request its own pool of up to four
connections (`POSTGRES_POOL_MAX`): Workers cannot share sockets across
requests, even through Hyperdrive. The pool closes when the request finishes;
Hyperdrive retains the origin connections. Transient acquisition failures retry
once before any SQL runs; an exhausted connection or checkout timeout returns
HTTP 503. The pool never retries queries or transaction callbacks after
acquisition. Sentry records the acquisition stage, attempt count, and bounded
pool counters; see [API diagnostics](api-sentry.md). The 30 s idle timeout
allows reuse during a long request. `POSTGRES_COALESCE_WRITES` gathers each
query's protocol messages into one socket write. `POSTGRES_POOL_MAX_USES=1`
applies only to work outside an event scope, whose sockets must not survive a
checkout. The realtime hub also scopes its HTTP, RPC, WebSocket, and alarm
events, closing their pools before it can hibernate. See
[realtime hub hibernation](realtime-hints.md#cloudflare-hub-hibernation).
The `local` Wrangler environment keeps the direct
Postgres transport for workerd tests. Deployed environments require Hyperdrive.

Keep the `aws:us-east-1` placement hint until measurements from multiple client
regions justify Smart Placement. Hyperdrive removes connection setup costs, but
registration issues many sequential queries, so its latency depends on
placement. Smart Placement needs sustained traffic from multiple
locations to learn a placement; a single deployment smoke cannot establish it.
