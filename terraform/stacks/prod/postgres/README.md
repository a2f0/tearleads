# Production PlanetScale Postgres

This stack manages `tearleads/tearleads-prod`, branch `main`, independently of
the production server. Its S3 state key is `prod/postgres/terraform.tfstate`,
using the existing backend in `terraform/configs/backend.hcl`. Server rebuilds
and `deployProduction.sh` / `deployEverything.sh` do not run this stack.

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
protection. Additional changes such as resizing may require further scopes;
use the permissions documented for the corresponding API operation. The CLI
bootstrap below uses your interactive login, so Terraform does not need
organization-wide database creation access.

Store these exports in the gitignored `.secrets/planetscale.env` with mode
`0600`, or supply them through your shell/secret manager:

```sh
export PLANETSCALE_SERVICE_TOKEN_ID='your-token-id'
export PLANETSCALE_SERVICE_TOKEN='your-token'
export TF_VAR_planetscale_branch_id='your-main-branch-id'
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

Set `TF_VAR_planetscale_branch_id` in `.secrets/planetscale.env` to that ID. If
you selected x86 in the dashboard, also set
`TF_VAR_planetscale_cluster_size=PS_5_AWS_X86` so Terraform keeps that choice.

## Import and manage

From the repository root:

```sh
bash terraform/scripts/run-postgres-stack.sh plan
bash terraform/scripts/run-postgres-stack.sh apply
bash terraform/scripts/run-postgres-stack.sh output -json database
```

The first plan should import one branch, optionally updating deletion
protection, with no creates, replacements, or destroys. Confirm its region
and PS-5 size match the database you created. Later plans should show no
changes. A nonzero replica count fails the lifecycle check; correct it in
PlanetScale before proceeding. Terraform cannot change that setting.

Application credentials, data migration, and changing the API connection are
separate steps. This stack only manages the database infrastructure. The API
still uses its existing Postgres connection until a migration is performed.

## Local checks

These checks use mock resources and require no PlanetScale or AWS credentials:

```sh
terraform -chdir=terraform/stacks/prod/postgres init -backend=false
terraform -chdir=terraform/stacks/prod/postgres validate
terraform -chdir=terraform/stacks/prod/postgres test
```

The tests accept a single-node import and reject replicas and larger sizes.
They also run through `bash scripts/checks/checkTerraform.sh`.

[PlanetScale pricing]: https://planetscale.com/docs/postgres/pricing
[Provider 1.9]: https://github.com/planetscale/terraform-provider-planetscale/blob/v1.9.0/docs/resources/postgres_branch.md
[service token guide]: https://planetscale.com/docs/cli/service-tokens
[PlanetScale CLI]: https://planetscale.com/docs/cli/planetscale-environment-setup
