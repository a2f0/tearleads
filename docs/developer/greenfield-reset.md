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

## Web-only soft-reset command

Use [`scripts/deploy/softReset.ts`](../../scripts/deploy/softReset.ts) for the
application-only reset with **no native mobile or desktop builds/releases**:

```sh
bun run soft-reset
bun run soft-reset --help
bun run soft-reset prod --preview

# Destructive: only after separately authorizing the selected tier's reset.
bun run soft-reset prod --apply --confirm "RESET prod APPLICATION DATA"
bun run soft-reset staging --apply --confirm "RESET staging APPLICATION DATA"
```

No arguments, help, and preview load no credentials and call no providers.
Apply requires the exact tier and confirmation phrase; there is no default
production tier, force flag, automatic retry, or resume mode. Run from a clean,
committed checkout with dependencies already installed. The source commit and
tracked/untracked status are checked before and after every phase. Coordinate
exclusive provider access: the local lock does not serialize other machines or
unrelated operator commands.

### Prerequisites and ordering

Use the pinned repository build/Terraform tools, Bash, AWS CLI, curl, jq,
Python, and a `psql` supporting `sslrootcert=system` (libpq 17 or newer).
Configure the selected tier's existing Terraform backend, Cloudflare,
PlanetScale, billing, healthcheck, and optional Sentry credentials through the
normal deployment helpers. An existing cursor signing key is required; the
command never requests key rotation. Provider output and command failures go
to private files, not the terminal. Inherited AWS profiles and session tokens
are removed, not blanked, before blob probes use the inspected credentials.
`TEARLEADS_TEARDOWN_TIER` is passed only to the maintenance, drop-owned, and
empty-R2 helpers, never to ordinary builds or deployments.

Authorization belongs to this command's exact apply confirmation, which is
checked before creating a run or planning destruction. An inherited teardown
marker cannot replace that confirmation. The PostgreSQL/storage wrappers
deliberately permit plan/apply, including the
[existing saved-plan destruction route](#production-destruction-protections),
without that marker; they reject only the direct `prod destroy` command.
They are low-level tools for trusted operators, not a general deletion-policy
boundary. Soft reset separately validates the exact resource/action/identity
scope and binds apply to the inspected bytes. Ordinary saved replacements or
resource removals are not reclassified as full teardowns by this command.

Before downtime the command verifies expected database/branch, Cloudflare
account, blob bucket/endpoint, migration role, and unchanged hostnames. It
requires healthy API/app/demo/site endpoints, plans with no actionable drift
([narrow drift exceptions](soft-reset-drift.md)), direct read-only TLS database
access, and authenticated blob listings. Saved destruction plans must match
explicit resource/action allowlists: only the application database, its roles
and Hyperdrive, and the blob bucket's configuration/token are allowed.
It does not use the broader, immediately-applying `destroy-stack.sh` helper.

It then builds SQLite/SDK runtime dependencies, prepares **devkit configuration
only** for the website's Astro discovery, and prebuilds website, both browser
variants, and the API bundle. API preflight is Wrangler dry-run only, without
Sentry uploads, migrations, or secret synchronization. Website prebuild uses
existing screenshot provenance validators: missing, stale, dirty, or incomplete
captures fail before maintenance. Use the shared `take-screenshots` workflow
outside the reset to repair captures; this command never recaptures them.
These builds do not guarantee that a later provider upload will succeed.

The explicit data/deploy sequence is:

1. Publish `deployApiMaintenance.sh` in place, including retirement of the old
   Durable Objects/crons and its mandatory **930-second** drain.
2. Recheck inventory, drop owned application objects, and assert no relations
   remain in `public` or `drizzle` (provider `pscale_extensions` views are not
   application data). Apply the exact inspected PostgreSQL destruction plan.
3. Empty only `tearleads-blobs-<tier>`, verify no objects/multipart uploads
   remain, and apply its inspected storage destruction plan.
4. Generate, validate, and apply saved creation plans through the individual
   PostgreSQL/storage wrappers, not `prepare-*`. Require a different database
   branch ID, the expected bucket/account, and empty application data.
5. Deploy API through its normal migration/secret reconciliation helper and
   verify health. Check initialized table names, the baseline migration hash,
   and zero rows in every application table. The verifier intentionally fails
   closed if the single-greenfield-baseline layout changes.
6. Deploy app and demo through `deployAppWeb.sh` (including its `dist-app` and
   `dist-demo` staging), then website with `--skip-terraform`. Check unchanged
   inventory and HTTP 200 on API/app/demo/site without registering test users.

`pg_tables.tablename` is a `name` in `C` collation, so its order matches ASCII
baseline names, not database locale ([PostgreSQL 12](https://www.postgresql.org/docs/release/12.0/)).

This preserves edge/website domain resources, downloads, Terraform backend
state, signing files, and external payment/store records. It rotates database
and blob runtime credentials; the API's normal deployment also reconciles
remote Worker secrets, including removal of unmanaged secrets. It does **not**
promise to retain arbitrary remote Worker secrets. Existing client-local data
and identity pins are unchanged; coordinate users and writers during the reset.
Public clients can write again once API publication ends maintenance, so an
empty-data check can legitimately fail if a client has already registered.
HTTP checks are not browser/account smoke tests or proof of external-provider
cleanup. Native release instructions elsewhere in this runbook do not apply to
this command.

### Timing records and manual recovery

Each authorized run creates a mode-0700 directory under
`~/.local/state/tearleads-soft-reset/run-*` and a per-tier directory lock in
that same location. All clones using the same OS home share that lock; do not
change `HOME` to evade it. `timings.json` records the pinned source, each
started phase's status/elapsed milliseconds, and total runtime. The terminal
prints the same summary on success, failure, SIGINT, SIGTERM, or SIGHUP.
Cancellation exits with the first signal's code: 130 for SIGINT, 143 for
SIGTERM, and 129 for SIGHUP. Later operator signals do not accelerate teardown
or change that code, including when automatic cleanup began first. An operator
signal during natural-exit observation starts the full policy grace; signals
after cleanup begins neither resend its signal nor change its fixed deadline.

When a command leader exits, its owned group gets a **one-second no-signal
observation period** for ordinary descendant teardown. If the whole group
finishes in that window, the original exit code is preserved. Otherwise, the
reset starts automatic cleanup and **fails the command even if its leader
exited zero** and the descendants stop cooperatively. The failed step retains
its timing, lock, and private evidence; no later reset effect runs. The reset's
source checks and API source/index probes disable inherited Git fsmonitor.

Commands that can run Terraform receive **one SIGINT** to their detached
process group and a fixed **60-second grace period**, measured from the first
cancellation or automatic cleanup, to stop work, save partial state, and release
backend locks. This
includes `init` inside stack-output wrappers, plan/apply, API preflight and
API deployment, and the drop-owned/empty-bucket helpers. A wrapper exiting
does not end the grace period while descendants remain. Wrappers also stop
after interrupted initialization even when Terraform exits zero. Ordinary builds,
maintenance, non-Terraform deployers, and direct read-only probes instead
receive SIGTERM with a one-second grace period.

At the deadline, the remaining group receives SIGKILL, with a one-second
post-kill observation budget. A forced-timeout diagnostic means
**state may be incomplete and a backend lock may remain**; even graceful
completion is not proof that every provider persisted successfully. Do not
send signals directly to Terraform or its providers, kill the reset parent,
or assume an exited shell means its descendants finished. Processes that
escape the owned group, host failure, and noncooperating providers require
manual investigation. The grace period is not configurable through environment
variables or CLI flags, and cancellation never starts a later reset step.

Successful runs retain sanitized identity/schema/timing records and remove
their private command outputs, saved plans, and owned lock. A failed or
interrupted run keeps its lock and private evidence, including sensitive
credentials/plans, so an accidental fresh run is refused. A hard kill or host
failure can leave a `running` phase; do not interpret that as success.

There is **no rollback**. On failure, stop and read the exact failed phase and
its private command logs. Confirm the owner PID and its children are gone,
identify current provider resources and whether maintenance is still serving,
and reconcile Terraform state with live identities. Never repeat `drop-owned`
against a newly created database or replay a destruction plan after a partial
rebuild. Restore service using individually reviewed creation/deployment steps
only, with fresh inspected plans and current connections. If a preflight
failed, establish that no maintenance/data phase ran before starting over.

After recovery is verified, explicitly archive the incident's timing/identity
records, remove only that run's no-longer-needed private credentials/plans,
and release only its identified lock. Foreign/stale overrides and locks are
never automatically removed. No blanket cleanup, unlocking flag, or blind
rerun is safe. Fixtures exercise orchestration, refusal, timings, and process
cleanup; they do not establish real provider permissions or live reset success.

## Identity-bound principal format

The complete member identity commitment introduced by
[#2847](https://github.com/a2f0/tearleads/issues/2847) is a reset-only protocol
change. Every signed principal projection now requires
`identityBundleFingerprint`, bound into its `projectionRoot`. Filling an old
row from today's identity endpoint would change the signed projection; there
is no backfill, legacy-envelope fallback, or mixed-format rollout.

Before deploying this format to an existing environment, separately authorize
and perform the selected environment's reset. Apply the Postgres migrations,
deploy matching API and client builds, and use fresh client databases. The
API identity trust domain and every client's configured domain must agree,
including any API base path; see
[identity trust configuration](trusted-user-identity.md#trust-domain-configuration).

Old local principal caches, saved history, pending principal mutations, and
organization provisioning attempts cannot be resumed under the new format.
The SDK refuses obsolete tables before changing them. Local backup version 17
requires the new projection format and rejects older backups; relabeling an old
backup is not a migration. Do not silently erase identity pins or checkpoints
to bypass a refusal. Clearing local data is an explicit security reset, as
described under [existing client devices](#external-and-operational-state-to-address).

Merging the format change does not perform or authorize a deployed-data reset.

## Preflight before downtime

Use a new private run directory, `umask 077`, and a lock identifying the active
reset. Record the source commit and phases so another session can resume. Do not
source an old run's helper or apply an old destruction plan.

Check these before teardown:

- Clean source, available `ship-pr` skill, required build/check tooling from
  [`.mise.toml`](../../.mise.toml), and release prerequisites in the
  [release runbook](greenfield-reset-releases.md).
- Authenticated
  [Terraform state backend](./infrastructure.md#infrastructure-lifecycle) (the
  tier's R2 state key), Cloudflare (the Terraform token, which the deploy
  scripts also export for Wrangler), and PlanetScale access. Do not print tokens
  while checking.
- Each stack's state key and resource identities; current database branch ID,
  connection metadata, blob count, multipart uploads, and
  relevant external [billing state](./revenuecat-billing.md). Preserve the
  production migration connection privately until the old database has been
  removed.
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
The PostgreSQL/storage wrappers reject the direct `prod destroy` command;
they do not inspect plan actions or enforce the teardown marker on plan/apply.
The authorized full-reset route is an inspected `plan -destroy` followed by
`apply` of that saved plan with the temporary lifecycle override. Confirmation,
override ownership, and plan inspection belong to the caller. Keep the
wrapper's ordinary protections intact; its command allowlist is not a promise
that arbitrary Terraform arguments or saved plans cannot delete resources.

`terraform/scripts/destroy-stack.sh <tier> <stack>` implements that route. It
derives the protected addresses from the stack's configuration, writes the
override, applies the saved destroy plan, and removes the override however it
exits; an override already present stops it. It and the other production
teardown helpers
([`drop-postgres-owned.sh`](../../terraform/scripts/drop-postgres-owned.sh),
[`empty-r2-bucket.sh`](../../terraform/scripts/empty-r2-bucket.sh),
[`deployApiMaintenance.sh`](../../packages/api/scripts/deployApiMaintenance.sh),
and the Worker deletion scripts) refuse `prod` unless
`TEARLEADS_TEARDOWN_TIER=prod` is exported, which
[`scripts/deploy/destroyProduction.sh`](../../scripts/deploy/destroyProduction.sh)
does once confirmed. An authorized production reset exports it in its own shell.

## Destroy one environment

Use the selected tier's wrappers, from the repository root. `TIER` must be
exactly `prod` or `staging`; `RUN_DIR` must be the absolute path of this run's
private directory.

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
maintenance response, and drains for 15.5 minutes: invocations the old version
started keep running, a Cron invocation for up to 15 minutes and `waitUntil`
work for 30 seconds past its response. HTTP requests have no duration limit, so
the data phases fence any that outlive the drain: `DROP OWNED` waits for their
open transactions and leaves nothing for later ones to write to, deleting the
runtime role and Hyperdrive configuration ends their database access, and R2
refuses to delete a bucket a straggler wrote into, which stops the teardown
visibly. Confirm both, and that `dig +short` for the API, app, and
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
per-object errors and verify emptiness; HTTP success alone does not prove every
object was deleted. Do not bypass an unexpected retention or
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
stack. Use
[`run-postgres-stack.sh`](../../terraform/scripts/run-postgres-stack.sh) and
[`run-storage-stack.sh`](../../terraform/scripts/run-storage-stack.sh) with
inspected plans. Confirm the new database branch ID differs from the old ID and
its connection verifies TLS. Use client connection evidence with
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
  object's next [projection read](../glossary/sync.md#writer-projection)
  verifies its retained history in full once and writes the markers back.
- **Existing client devices:** a reset wipes the server but not the devices
  that used it, and each keeps its
  [identity-trust store](./trusted-user-identity.md#pinning). That store binds
  each signing key to one user, so on such a device registration is declined,
  and login fails because the server no longer knows the key. Clearing the
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
unneeded. Keep a sanitized summary; private plans and logs
remain sensitive, including database credentials in Terraform outputs.

Report infrastructure and releases separately from retained provider records.
A successful infrastructure reset does not establish that external providers
have lost their previous state.
