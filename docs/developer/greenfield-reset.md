# Greenfield environment reset

Operational reference for the `greenfield-reset` skill in Codex and Claude.
This procedure replaces the selected environment's application data and
redeploys its Workers in place, under unchanged hostnames.
Use current repository scripts and live resource identities. Never reuse Worker
versions, credentials, build numbers, or Terraform plans from a previous run.

## Reset boundary

| State | Full environment reset |
| --- | --- |
| Production database | Replace the independent PlanetScale database and its runtime/migration roles. |
| Staging database | Replace the staging PlanetScale database and its roles, then initialize the current baseline. |
| Encrypted blobs | Empty and replace only the selected application bucket and its bucket-scoped R2 credentials. |
| Worker state | Publish the API maintenance Worker, whose `exports` tombstones delete both Durable Object namespaces (sessions, tickets, and hibernated socket state), then redeploy the API, which recreates them empty. A plain redeploy keeps that state. Never delete the API Worker. |
| Hostnames | Retain. The API, app, and demo hostnames stay attached throughout; a reset changes no edge stack resource. |
| Website, web app, demos | Redeploy in place; retain their domain/account identities. |
| Desktop/mobile releases | Build and publish selected tiers using the release matrix. |
| Terraform backend and release buckets | Retain, including historical immutable downloads. |
| Signing, store and payment-provider resources | Retain; reconcile external records separately when requested. |

The application buckets are `tearleads-blobs-prod` and
`tearleads-blobs-staging`. The `tearleads-downloads-prod` and
`tearleads-downloads-staging` buckets are release dependencies. Resolve and
compare bucket identities from the selected stack before any object deletion.
Never broaden an application reset into account-wide bucket or resource cleanup.
[`scripts/deploy/destroyProduction.sh`](../../scripts/deploy/destroyProduction.sh)
is a complete production teardown, wider than this reset: it also deletes the
downloads bucket with every published release, and the website. Do not use it
for a reset.

Authoritative details:
[API persistence](api-persistence.md),
[production Postgres](../../terraform/stacks/prod/postgres/README.md), and
[blob storage](../../terraform/modules/r2-object-storage/README.md).

## Preflight before downtime

Use a new private run directory, `umask 077`, and a lock identifying the active
reset. Record the source commit and phases so another session can resume. Do not
source an old run's helper or apply an old destruction plan.

Check these before teardown:

- Clean source, available `ship-pr` skill, required build/check tooling from
  `.mise.toml`, and release prerequisites in the
  [release runbook](greenfield-reset-releases.md).
- Authenticated Terraform state backend (the tier's R2 state key), Cloudflare
  (the Terraform token, which the deploy scripts also export for Wrangler), and
  PlanetScale access. Do not print tokens while checking.
- Each stack's state key and resource identities; current database branch ID,
  connection metadata, blob count, multipart uploads, and
  relevant external billing state. Preserve the production
  migration connection privately until the old database has been removed.
- Old API/app/demo/site health and current download manifests/store numbers.
  Distinguish a pre-existing outage from a reset failure.
- Inspect saved deletion plans for exactly the selected stacks. If source or
  live state changes, refresh the plans and inspect them again. Resource counts
  from an earlier reset are not acceptance criteria.

Immediately before each destructive phase, report the tier, frozen source SHA,
database branch ID where applicable, exact bucket name, and the saved plan to
be applied. Recheck those identities against current provider/state
readback and the user's authorized scope. If they differ, stop and resolve the
specific discrepancy before deletion. An earlier preflight or a successful
`ship-pr` run does not replace this check.

If the requested reset discards data, proceed on that basis; do not create or
restore a data backup implicitly. Retain Terraform state and private operational
records needed for recovery. When backup retention is requested, record its
scope and location; an old data restore reverses the fresh-start outcome.

## Production destruction protections

Production database and blob resources intentionally use `prevent_destroy`.
For an explicitly authorized complete production data reset, use temporary,
stack-local `greenfield_reset_override.tf` files. Derive addresses from the
current configuration. The protected addresses are:

- Postgres: `restapi_object.database`, `restapi_object.main_protection`,
  `planetscale_postgres_branch_role.runtime`, and
  `planetscale_postgres_branch_role.migrations`.
- Storage: `cloudflare_r2_bucket.blobs`.
- Downloads: `cloudflare_r2_bucket.downloads`, which a reset retains; only a
  complete teardown removes it.

Each override restates only the exact resource type/name and
`lifecycle { prevent_destroy = false }`. Do not change tracked protections,
enable broad `force_destroy`, or remove resources from Terraform state. Install
cleanup handling for these exact files, check their absence explicitly on
resume, and remove them immediately after destruction, before any creation plan.
They are gitignored, so a clean `git status` does not prove their absence.

The database protection resource's destroy action releases PlanetScale branch
deletion protection in the correct dependency order. Let Terraform execute it.
The storage wrapper rejects `prod destroy`; the authorized full-reset route is
an inspected `plan -destroy` followed by `apply` of that saved plan with the
temporary lifecycle override. Keep the wrapper's ordinary protections intact.

`terraform/scripts/destroy-stack.sh <tier> <stack>` implements that route. It
derives the protected addresses from the stack's configuration, writes the
override, applies the saved destroy plan, and removes the override however it
exits; an override already present stops it. It and the other production
teardown helpers (`drop-postgres-owned.sh`, `empty-r2-bucket.sh`,
`deployApiMaintenance.sh`, and the Worker deletion scripts) refuse `prod` unless
`TEARLEADS_TEARDOWN_TIER=prod` is
exported, which
[`scripts/deploy/destroyProduction.sh`](../../scripts/deploy/destroyProduction.sh)
does once confirmed. An authorized production reset exports it in the reset's
own shell.

## Destroy one environment

Use the selected tier's wrappers. `TIER` must be exactly `prod` or `staging`;
`RUN_DIR` must be the absolute path of this run's private directory.
Run examples from the repository root.

### 1. Stop old writers in place

A reset never changes a hostname. Leave the edge stack and the app and demo
Workers alone, and never delete the API Worker: `wrangler delete` also removes
the Worker's custom domain and its DNS record (observed with Wrangler 4.123.0).
A detached hostname answers NXDOMAIN, which resolvers and browsers keep caching
after the rebuild: after the 2026-10-31 production reset detached the
hostnames, Brave kept failing `POST /auth/register` with "Failed to fetch"
until its host cache was cleared.

Stop the API in place instead, by publishing the maintenance Worker:

```bash
packages/api/scripts/deployApiMaintenance.sh "$TIER"
```

It deploys
[`packages/api/wrangler.maintenance.jsonc`](../../packages/api/wrangler.maintenance.jsonc)
under the tier's API Worker name, so the custom domain stays bound. In that one
deploy:

- every API request answers 503 with `Retry-After` and
  `x-tearleads-maintenance: reset`; CORS preflights still succeed, so browsers
  read the refusal instead of reporting a network error;
- the billing and blob garbage-collection Cron Triggers are removed;
- its `exports` `deleted` tombstones delete the `KeyValueStore` and
  `RealtimeHub` Durable Object namespaces with all their storage: every
  session, login challenge, WebSocket ticket, and hibernated socket.

Wrangler prints `Deleted: KeyValueStore` and `Deleted: RealtimeHub` under
"Durable Object exports reconciliation"; a rerun reports stale tombstones and
changes nothing. The script then waits until the public hostname serves the
maintenance response. Confirm both, and that `dig +short` for the API, app, and
demo hostnames through a public resolver still answers, before touching the
database or blob storage. The app and demo Workers keep serving their old
bundles, whose API calls now receive the 503.

### 2. Remove the application database

Both tiers have an independent PlanetScale database stack:

1. Verify the saved migration connection still names the **old** database's
   host, branch, and role. Require TLS with certificate verification and the
   direct migration port; never use a development connection fallback.
2. Run the documented `DROP OWNED BY CURRENT_USER CASCADE` through that migration
   connection. PlanetScale does not delete a role that still owns objects.
   This SQL belongs only to the authorized complete teardown. Check that the
   old application tables are gone.
   `terraform/scripts/drop-postgres-owned.sh "$TIER"` runs it from the stack's
   connection output; both tier teardown scripts include that step.
3. With the temporary overrides in place for production, prepare and inspect
   the database destruction plan, then apply it:

   ```bash
   terraform/scripts/run-postgres-stack.sh "$TIER" plan -destroy \
     -out="$RUN_DIR/$TIER-postgres-destroy.tfplan"
   terraform/scripts/run-postgres-stack.sh "$TIER" apply \
     "$RUN_DIR/$TIER-postgres-destroy.tfplan"
   ```

4. Confirm deletion of the old database and roles. Remove the database override.
   Never rerun the old SQL helper against a newly created connection.

### 3. Remove application blob storage

Enumerate only the verified application's R2 bucket, including all pages. Empty
objects through its S3 API endpoint using the stack's bucket-scoped credentials.
Inspect and abort remaining multipart uploads. Check deletion API results for
per-object errors and verify emptiness; a successful HTTP response alone does
not prove every object was deleted. Do not bypass an unexpected retention or
Object Lock policy; report that concrete blocker with the remaining resources.
Some AWS CLI queries return empty stdout for an empty result. Check the command
exit status first, then normalize that empty output before parsing JSON.

Prepare, inspect, and apply the storage destruction plan through the wrapper:

```bash
terraform/scripts/run-storage-stack.sh "$TIER" plan -destroy \
  -out="$RUN_DIR/$TIER-storage-destroy.tfplan"
terraform/scripts/run-storage-stack.sh "$TIER" apply \
  "$RUN_DIR/$TIER-storage-destroy.tfplan"
```

Production needs the temporary bucket override described above. R2 refuses
nonempty bucket deletion in either tier; `empty-r2-bucket.sh "$TIER" storage`
empties the bucket once the maintenance Worker has stopped its writers. Verify
removal of the bucket and account token, then remove any storage override. The
tier teardown scripts are a complete teardown, not a reset: they also detach the
hostnames, delete the Workers, the desktop downloads bucket (emptied first by
`empty-r2-bucket.sh "$TIER" downloads`), and the independently hosted website.
Use individual stacks for this workflow's database/blob boundary.

## Rebuild and resume

Remove all reset overrides before generating creation plans. Apply the tier's
Postgres stack, wait for readiness and role creation, then apply the storage
stack. Use `run-postgres-stack.sh` and `run-storage-stack.sh` with inspected
plans. Confirm the new database branch ID differs from the old ID and its
connection verifies TLS. Use client connection evidence with
`sslmode=verify-full`; a managed proxy's `pg_stat_ssl` backend row may describe
a different transport leg and cannot establish client TLS. Verify there are no
application tables before baseline initialization, and no old blobs in storage.

Run
[`scripts/deploy/deployProduction.sh`](../../scripts/deploy/deployProduction.sh)
or [`scripts/deploy/deployStaging.sh`](../../scripts/deploy/deployStaging.sh).
The staging script applies its database and storage stacks itself; the
production script requires both to exist already. The API deploy initializes the
baseline schema with the migration login, syncs the Worker secrets, and
publishes the Worker, which ends maintenance; its `exports` entries recreate
both Durable Object namespaces empty (Wrangler prints `Created:` for each), so
no old session can survive the reset. The edge stack apply in those scripts
changes nothing, because the hostnames stayed attached; a plan that would
create or replace a custom domain means something detached one. Record
`dig +short api.<domain> @1.1.1.1` (and the app and demo hostnames) before,
during, and after the reset. The document sync cursor HMAC key persists in
`.secrets/<tier>/worker.env`; delete that file before the rebuild when the reset
should rotate it.

Verify current schema initialization and application-table emptiness before any
test identities are created. Compare schema against the current baseline rather
than a historical table count. Derive read-only SQL probes from the `postgres`
stack's `api_connection` output in a private shell, with TLS verification.

Use `--skip-terraform` only after infrastructure exists. Record completed
phases and actual live identities; an orchestration failure is not grounds to
repeat destructive phases. Once the tier is healthy, rebuild the next selected
tier before long store uploads.

## External and operational state to address

- **Sessions and credentials:** verify the replacement key/value store contains
  no old sessions, replacement database/R2 runtime credentials are deployed, and
  old roles/keys are gone. If an old test session is available securely, verify
  it is refused. Keep account-level API tokens and signing keys unless rotation
  is separately requested. Inventory retained application secrets such as
  `DOCUMENT_SYNC_CURSOR_HMAC_KEY` and report any requested rotation separately;
  recreating infrastructure does not change persistent env-file values. Rotating
  that key also retires every stored-history verification marker, so each
  object's next projection read verifies its retained history in full once and
  writes the markers back.
- **Existing client devices:** a reset wipes the server but not the devices
  that used it, and each keeps its identity-trust store. That store binds each
  signing key to one user, so on such a device registration is declined, and
  login fails because the server no longer knows the key. Clearing the
  device's local app data recreates the trust store; the SDK never clears it on
  the server's say-so. Tell anyone who used the environment to do this, and use
  fresh profiles for post-reset checks.
- **Billing and provider callbacks:** inventory Stripe/native-store customer,
  subscription, purchase, and webhook state that outlives the application
  database. Report orphaned associations, ongoing subscriptions, and possible
  retries. Cancellation, provider test-data deletion, and webhook changes require
  explicit scope; a database wipe does not cancel billing. Do not replay old
  events or run chargeable smoke tests implicitly.
- **Operational leftovers:** compare old Worker/Durable Object/DNS/IAM
  identities with the new ones and inspect for remnants. Remove only resources
  proved to belong to this reset and covered by its scope. Check the blob-GC and
  billing Cron Triggers, failure alerts, and current release/source-map
  configuration. Preserve historical observability data; label test telemetry
  when a live diagnostic probe is requested.

## Completion evidence

Follow the [release runbook](greenfield-reset-releases.md) for publications and
fresh-profile functional verification. Record before/after identities, schema
and blob checks, HTTP results, and restored protections. Remove this run's
temporary overrides, locks, and obsolete copies of migration credentials once
they are no longer needed. Keep a sanitized summary; private plans and logs
remain sensitive, including database credentials in Terraform outputs.

Report infrastructure and releases separately from retained provider records.
A successful infrastructure reset does not establish that external providers
have lost their previous state.
