# Production PlanetScale Postgres

This stack owns `tearleads/tearleads-prod`, branch `main`, its API roles, and
the API Hyperdrive configuration. Its independent R2 state key is
`prod/postgres/terraform.tfstate`. Worker redeploys preserve the database; the
API deploy reads its connection output.

## Provisioning

Terraform creates the database through PlanetScale's database API with
`replicas = 0`, using the REST API provider. The native PlanetScale branch
resource cannot set replicas and creates two replicas by default. The native
provider manages the PostgreSQL roles and reads the current branch for checks.

The selected size is PS-5 in `us-east` (AWS us-east-1). A readiness step waits
for the new database before Terraform creates the roles. Each plan verifies
size, region, zero replicas, and branch deletion protection. The database,
protection setting, and roles also have `prevent_destroy` enabled. A deliberate
teardown releases branch protection before deleting the database.

PlanetScale refuses to delete a role that owns database objects. A deliberate
reset of a populated database first runs `DROP OWNED BY CURRENT_USER CASCADE`
through the migration connection, then destroys the roles and database. This
deletes application data and belongs only in a complete database teardown.

Store these exports in gitignored `.secrets/prod/planetscale.env` (staging:
`.secrets/staging/planetscale.env`), mode `0600`:

```sh
export PLANETSCALE_SERVICE_TOKEN_ID='your-token-id'
export PLANETSCALE_SERVICE_TOKEN='your-token'
export TF_VAR_planetscale_cluster_size='PS_5_AWS_ARM'
```

The token needs organization database creation access and the database/branch
and PostgreSQL role permissions used by the provider. The wrapper loads
Cloudflare settings (`TF_VAR_cloudflare_api_token` and
`TF_VAR_cloudflare_account_id`) from the tier's `.secrets/<tier>/shared.env`,
the R2 state key (`TF_STATE_ACCESS_KEY_ID` and `TF_STATE_SECRET_ACCESS_KEY`)
from `.secrets/<tier>/app.env`, and PlanetScale settings from
`.secrets/<tier>/planetscale.env`. The Cloudflare token needs Hyperdrive Edit.

```sh
umask 077
PLAN_DIR="$(mktemp -d)"
bash terraform/scripts/run-postgres-stack.sh prod plan -out="$PLAN_DIR/planetscale-prod.tfplan"
bash terraform/scripts/run-postgres-stack.sh prod apply "$PLAN_DIR/planetscale-prod.tfplan"
rm -rf "$PLAN_DIR"
bash terraform/scripts/run-postgres-stack.sh prod output -json database
```

A fresh apply creates the database, configures protection, waits for readiness,
creates two roles, and provisions Hyperdrive. Subsequent plans should be empty.
Terraform state and saved plans contain credentials and require private storage;
keep saved plans outside `.secrets` and delete them once applied. The wrapper
disables interactive variable prompts.

## Production API dependency

This stack owns the database and its non-expiring `tearleads-runtime` and
`tearleads-migrations` logins. The database, protection setting, and roles use
`prevent_destroy`; the main branch also has PlanetScale deletion protection.
Keep this stack and its R2 state when redeploying the Workers. Deletion protection
is a guard against accidents, not a substitute for retaining state and backups.

`packages/api/scripts/deployApi.sh prod` reads the sensitive `api_connection`
Terraform output into a mode-0600 temporary directory and removes it on exit.
Reading the output needs backend access; it does not apply this stack or need
a PlanetScale API call. The deploy runs migrations through the API CLI with the
migration login, then reads the non-secret `hyperdrive_id` output into the
selected environment's temporary Wrangler configuration. It deletes any Worker
secret it does not manage, so no `POSTGRES_*` connection secret survives on the
Worker. The runtime credentials stay in this Terraform state and Hyperdrive;
`api_connection` exports only the host, database, and migration login. The
Worker never receives the migration login, the PlanetScale service token, or
the R2 state key.

The runtime login inherits `pg_read_all_data` and `pg_write_all_data`. Hyperdrive
connects with it through the included PgBouncer on port 6432. Its `require` SSL
mode enforces TLS and validates server certificates against WebPKI. Hyperdrive
query caching is disabled because authorization and sync reads must observe
writes immediately. Its soft origin connection limit is 20; PgBouncer shares
the PS-5 server pool. Each Worker request has its own pool of at most four
connections to Hyperdrive, closed when the request completes. Hyperdrive retains
origin connections across requests. The migration login inherits `postgres` and
connects directly on port 5432 for the duration of the deploy only.

Staging has its own copy of this stack under
`terraform/stacks/staging/postgres` without `prevent_destroy`;
`scripts/deploy/destroyStaging.sh` empties and destroys it, including
Hyperdrive. `scripts/deploy/destroyProduction.sh` does the same for production,
lifting `prevent_destroy` for that run with temporary overrides. Recreating a
Hyperdrive configuration requires only a Worker redeploy to bind its new ID.
See [PlanetScale roles], [connection options], and [Hyperdrive TLS].

## Deployment order

1. Apply this database stack.
2. Apply the independent [R2 storage stack](../../../modules/r2-object-storage/README.md).
3. Run `scripts/deploy/deployProduction.sh` to migrate the database, deploy the
   API Worker with its Hyperdrive binding, publish the app and demo Workers,
   and attach the hostnames.

Staging has its own copies of this stack and the R2 storage stack, and
`scripts/deploy/deployStaging.sh` applies both itself. Neither environment has
a data conversion or backfill step: the API baseline initializes a fresh
database, and schema resets replace the database and client caches together.

## Validation

```sh
terraform -chdir=terraform/stacks/prod/postgres init -backend=false
terraform -chdir=terraform/stacks/prod/postgres validate
terraform -chdir=terraform/stacks/prod/postgres test
```

Mock tests verify size, region, zero replicas, deletion protection, separate
runtime and migration credentials, the Hyperdrive binding ID, disabled query
caching, TLS, the pooled runtime port, and matching connection hosts.

[PlanetScale roles]: https://planetscale.com/docs/postgres/connecting/roles
[connection options]: https://planetscale.com/docs/postgres/connecting

[Hyperdrive TLS]: https://developers.cloudflare.com/hyperdrive/configuration/tls-ssl-certificates-for-hyperdrive/
