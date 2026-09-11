# Production PlanetScale Postgres

This stack owns `tearleads/tearleads-prod`, branch `main`, and its API roles.
Its independent S3 state key is `prod/postgres/terraform.tfstate`. Server
rebuilds preserve the database; production Ansible reads its connection output.

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

Store these exports in gitignored `.secrets/planetscale.env`, mode `0600`:

```sh
export PLANETSCALE_SERVICE_TOKEN_ID='your-token-id'
export PLANETSCALE_SERVICE_TOKEN='your-token'
export TF_VAR_planetscale_cluster_size='PS_5_AWS_ARM'
```

The token needs organization database creation access and the database/branch
and PostgreSQL role permissions used by the provider. The wrapper loads backend
credentials from `.secrets/root.env` and provider settings from
`.secrets/planetscale.env`.

```sh
umask 077
bash terraform/scripts/run-postgres-stack.sh plan -out="$PWD/.secrets/planetscale-prod.tfplan"
bash terraform/scripts/run-postgres-stack.sh apply "$PWD/.secrets/planetscale-prod.tfplan"
bash terraform/scripts/run-postgres-stack.sh output -json database
```

A fresh apply creates the database, configures protection, waits for readiness,
and creates two roles. Subsequent plans should be empty. Terraform state and
saved plans contain credentials and require private
storage. The wrapper disables interactive variable prompts.

## Production API dependency

This stack owns the database and its non-expiring `tearleads-runtime` and
`tearleads-migrations` logins. The database, protection setting, and roles use
`prevent_destroy`; the main branch also has PlanetScale deletion protection.
Keep this stack and its S3 state when rebuilding the server. Deletion protection
is a guard against accidents, not a substitute for retaining state and backups.

`ansible/scripts/run-server-prod.sh` reads the sensitive `api_connection`
Terraform output into a mode-0600 temporary file, passes it to Ansible, and
removes it on exit. Reading the output needs backend access; it does not apply
this stack or need a PlanetScale API call. Credentials stay out of the server
Terraform state and cloud-init. The server never receives the PlanetScale
service token or AWS state credentials.

Ansible writes the application connection to `/etc/tearleads/api.env` with mode
0640 and configures the API and maintenance services to use the external
database. Production skips local PostgreSQL installation and requires TLS with
certificate verification. Staging keeps its local PostgreSQL setup.

The runtime login inherits `pg_read_all_data` and `pg_write_all_data`. API and
maintenance traffic uses the included PgBouncer on port 6432. The migration
login inherits `postgres` and connects directly on port 5432; Ansible stores
its connection separately in root-owned `/etc/tearleads/migrations.env`, mode
0600. Deploy scripts run `sudo tearleads-api-cli migrate` through the operator
wrapper, which selects that file only for migrations. The runtime environment
contains no migration credentials. The deploy account retains its existing
administrative sudo access; these file permissions do not isolate credentials
from an administrator or a compromised deploy account. API and maintenance
services run with `ProtectSystem=strict` and no writable application directory,
so they cannot replace executables later invoked by the deployment operator.
Staging writes its
existing local login to both files. See [PlanetScale roles] and
[connection options].

## Deployment order

1. Apply this database stack.
2. Apply the independent [S3 storage stack](../../../modules/s3-blob-storage/README.md).
3. Run `scripts/deployProduction.sh` to provision the server, configure Ansible,
   initialize the current API schema, and deploy the applications.

Staging uses its local PostgreSQL server and independent S3 storage stack.
Neither environment has a data conversion or backfill step. The API baseline
initializes a fresh database; schema resets replace the database and client
caches together.

## Validation

```sh
terraform -chdir=terraform/stacks/prod/postgres init -backend=false
terraform -chdir=terraform/stacks/prod/postgres validate
terraform -chdir=terraform/stacks/prod/postgres test
```

Mock tests verify size, region, zero replicas, deletion protection, separate
runtime and initialization credentials, TLS, and matching connection hosts.

[PlanetScale roles]: https://planetscale.com/docs/postgres/connecting/roles
[connection options]: https://planetscale.com/docs/postgres/connecting
