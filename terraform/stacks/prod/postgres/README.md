# Production PlanetScale Postgres

This stack manages `tearleads/tearleads-prod`, branch `main`, independently of
the production server. Its S3 state key is `prod/postgres/terraform.tfstate`,
using the existing backend in `terraform/configs/backend.hcl`. Server rebuilds
and `deployProduction.sh` / `deployEverything.sh` never apply or destroy this
stack. Ansible reads its existing connection output when configuring production.

## Size and provider support

The target is **PS-5, Single Node, AWS us-east-1**: $5/month base price,
1/16 vCPU, 512 MB RAM, and 10 GB included storage. PS-5 ARM and x86 cost the
same. Additional storage, backup usage, and traffic can add charges. Single
Node has no replicas or automatic failover. See [PlanetScale pricing].

PlanetScale identifies AWS us-east-1 with the region slug `us-east` in its API,
CLI, and Terraform provider.

[Provider 1.9] can create a database through a branch resource, but `replicas`
is read-only. Choosing `PS_5_AWS_ARM` alone does not explicitly select Single
Node. Create the database once with zero replicas, then this stack imports
the existing branch. Keep the import block and branch ID in place. Terraform
checks for zero replicas and enables both branch deletion protection and
`prevent_destroy`.

## Authentication

In the `tearleads` organization, open **Settings → Service tokens → New service
token**. Name it `terraform-prod-postgres`, copy both the **ID** and **token**,
then select **Edit token permissions**. This is an organization setting; see
the [service token guide].

After creating the database, grant database access to `tearleads-prod` with
`read_branch` and `write_database` for reading the branch and enabling deletion
protection. Managing the API login also needs the create/read/update/delete
Postgres role permissions. Additional changes such as resizing may require
further scopes; use the permissions documented for the corresponding API
operation. The CLI
bootstrap below uses your interactive login, so Terraform does not need
organization-wide database creation access.

Store these exports in the gitignored `.secrets/planetscale.env` with mode
`0600`, or supply them through your shell/secret manager:

```sh
export PLANETSCALE_SERVICE_TOKEN_ID='your-token-id'
export PLANETSCALE_SERVICE_TOKEN='your-token'
export TF_VAR_planetscale_branch_id='your-main-branch-id'
export TF_VAR_planetscale_cluster_size='PS_5_AWS_ARM'
```

The wrapper loads backend AWS credentials from `.secrets/root.env` and then
`.secrets/planetscale.env`. It does not load `.secrets/prod.env`. Provider
credentials belong in environment variables, not Terraform configuration.

## One-time creation

In the dashboard, create `tearleads-prod` in organization `tearleads`, selecting
Postgres, AWS us-east-1 (N. Virginia), network-attached storage, **Single Node**,
and **PS-5 ARM**. Confirm the base price is $5/month. Use the included 10 GB
storage and the included local PgBouncer.

Alternatively, with the [PlanetScale CLI] installed, run this once to create
the billable database:

```sh
pscale auth login
pscale database create tearleads-prod --org tearleads \
  --engine postgresql --region us-east \
  --cluster-size PS_5_AWS_ARM --replicas 0 --wait
```

Use an interactive login before exporting service-token variables, or unset
those variables in the bootstrap shell so the CLI uses your login. After
creation, obtain the main branch ID:

```sh
pscale branch show tearleads-prod main --org tearleads --format json | jq -r '.id'
```

Set `TF_VAR_planetscale_branch_id` in `.secrets/planetscale.env` to that ID, and
set `TF_VAR_planetscale_cluster_size` to the size you selected during creation:
`PS_5_AWS_ARM` or `PS_5_AWS_X86`. Both inputs are required so an import preserves
the architecture chosen during bootstrap.

## Import and manage

Provider 1.9's [import schema] takes a JSON object containing `organization`,
`database`, and `id`, where `id` is the existing branch ID. This exact format
was used to import `tearleads-prod` successfully; the subsequent live plan
reported no changes.

From the repository root:

```sh
umask 077
bash terraform/scripts/run-postgres-stack.sh plan -out="$PWD/.secrets/planetscale-prod.tfplan"
bash terraform/scripts/run-postgres-stack.sh apply "$PWD/.secrets/planetscale-prod.tfplan"
rm -f "$PWD/.secrets/planetscale-prod.tfplan"
bash terraform/scripts/run-postgres-stack.sh output -json database
```

The first plan should import one branch, optionally updating deletion
protection, and create the runtime and migration logins. It must not create, replace,
or destroy the database branch. Confirm its region and PS-5 size match the
database you created. Later plans should show no
changes. A nonzero replica count fails the lifecycle check; correct it in
PlanetScale before proceeding. Terraform cannot change that setting.

Do not apply a plan proposing a create or replacement for this production
branch, including after deletion outside Terraform. Provision or recover a
single-node branch and import it first: the replica postcondition runs after
creation and cannot control the provider's creation defaults.

The wrapper disables input prompts for initialization, planning, and applying,
so missing variables fail immediately. Review the saved plan before applying
it; applying without a saved plan requires an explicit `-auto-approve` flag.

## Production API dependency

This stack owns the branch and its non-expiring `tearleads-runtime` and
`tearleads-migrations` logins. All three use `prevent_destroy`; the branch also
has PlanetScale deletion protection.
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

Deployment order:

1. Bootstrap the database once, then apply this persistent stack.
2. Run `scripts/deployProduction.sh`: it applies the server stack, configures
   the host with Ansible, runs database migrations, and deploys the applications.
3. For later server rebuilds, repeat step 2. The database and both logins survive.

This is the greenfield deployment path: the production server and database had
no existing application data at bootstrap. It does not copy data from another
Postgres server. For an existing deployment, stop API and maintenance writers,
take and retain a database backup, restore it into PlanetScale with the migration
login, and validate schema, row counts, and application access before running
step 2. Ansible refuses managed configuration while cluster markers
(`/var/lib/postgresql/<version>/<cluster>/PG_VERSION`) exist. An empty Postgres
home directory is allowed. After the restore is verified, stop and disable
local PostgreSQL and move the old cluster directories aside, retaining the
original data and backup. The guard runs before Ansible changes service
configuration or credentials.

A missing connection output stops production Ansible; apply this stack first.
To rotate a login, create a replacement role alongside the existing one,
point `api_connection` at it, apply this stack, rerun Ansible, and restart API
and maintenance processes before retiring the old role. Do not reset a password
in the dashboard and expect Terraform to retrieve it: passwords are returned
only at creation and retained in the sensitive Terraform state.

## Local checks

These checks use mock resources and require no PlanetScale or AWS credentials:

```sh
terraform -chdir=terraform/stacks/prod/postgres init -backend=false
terraform -chdir=terraform/stacks/prod/postgres validate
terraform -chdir=terraform/stacks/prod/postgres test
```

The tests accept a single-node import and reject replicas, larger sizes, and
an empty branch ID.
They also run through `bash scripts/checks/checkTerraform.sh`.

[PlanetScale pricing]: https://planetscale.com/docs/postgres/pricing
[Provider 1.9]: https://github.com/planetscale/terraform-provider-planetscale/blob/v1.9.0/docs/resources/postgres_branch.md
[import schema]: https://github.com/planetscale/terraform-provider-planetscale/blob/v1.9.0/docs/resources/postgres_branch.md#import
[service token guide]: https://planetscale.com/docs/cli/service-tokens
[PlanetScale CLI]: https://planetscale.com/docs/cli/planetscale-environment-setup

[PlanetScale roles]: https://planetscale.com/docs/postgres/connecting/roles
[connection options]: https://planetscale.com/docs/postgres/connecting
