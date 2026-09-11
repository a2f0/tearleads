# Staging and production blob storage

Both deployed APIs use private AWS S3 buckets in `us-east-1`, the region used by
production PlanetScale Postgres. S3 general-purpose buckets are regional; they
do not select an individual availability zone. Local development keeps its
existing LocalStack setup.

| Environment | Bucket | Independent Terraform state | IAM user |
| --- | --- | --- | --- |
| Production | `tearleads-prod` | `prod/storage/terraform.tfstate` | `tearleads-prod-blobs` |
| Staging | `tearleads-staging` | `staging/storage/terraform.tfstate` | `tearleads-staging-blobs` |

The roots in `terraform/stacks/{prod,staging}/storage` own the buckets. This
module owns their public-access blocks, disabled ACLs, SSE-S3 encryption, TLS
requirement, and separate application IAM users and access keys. Each user can
list its bucket and read, write, delete, and manage multipart uploads within it.
It cannot administer buckets or access the other environment. Deployment AWS
credentials from `.secrets/root.env` are used only on the deployment machine.

An S3 lifecycle rule aborts incomplete multipart uploads after seven days,
covering orphaned parts that have no database stage row for the application's GC
to find. API upload stages expire after one hour. This rule has no completed-object
expiration or storage-class transitions. See the
[AWS incomplete-upload lifecycle documentation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-abort-incomplete-mpu-lifecycle-config.html).

## Provision and deploy

Provision production storage once, independently of the server and Postgres:

```sh
umask 077
terraform/scripts/run-storage-stack.sh prod plan -out="$PWD/.secrets/prod-storage.tfplan"
terraform/scripts/run-storage-stack.sh prod apply "$PWD/.secrets/prod-storage.tfplan"
rm -f "$PWD/.secrets/prod-storage.tfplan"
scripts/deployProduction.sh
```

Production deploys require the existing storage output; they never apply its
stack. Staging deploys apply their storage stack before applying the server:

```sh
scripts/deployStaging.sh
```

`deployEverything.sh` uses the same ordering. `--skip-terraform` assumes both
storage and the server have already been provisioned. `--skip-infra` also skips
Ansible and uses the server's existing credentials.

Ansible reads the sensitive `api_storage` output from the appropriate state
into a mode-0600 file inside a private temporary directory and removes it on
exit. Its values take precedence over operator extra-vars. The server receives
only its own runtime credentials in `/etc/tearleads/api.env` (mode 0640), used by
the API and blob garbage collector. No credentials enter cloud-init or server
Terraform state. Access keys are sensitive Terraform state values: protect
backend access and saved plans, and do not print `api_storage` into logs.

## Rebuild and teardown

Rebuilding either server leaves its S3 bucket and IAM credentials intact.
Production's bucket has `prevent_destroy = true` and `force_destroy = false`;
the storage wrapper also rejects `prod destroy`. Keep its configuration and
state when rebuilding servers. These protections prevent accidental Terraform
deletion, but do not prevent authorized application object deletion.

Object versioning is disabled, preserving the application's current permanent
deletion behavior. Deleted or overwritten blobs cannot be recovered from S3.
The independent stack provides persistence across server rebuilds; object backup
and recovery would require a separate retention policy.

Staging uses `force_destroy = true`. To dispose of the entire staging environment:

```sh
scripts/destroyStaging.sh --auto-approve
```

This first destroys the server, then Terraform empties and deletes staging's
bucket and removes its IAM credentials. If server teardown fails, storage is
retained. A later `scripts/deployStaging.sh` creates a fresh bucket and key.
The full teardown accepts only the approval flag; partial Terraform operations
must use the individual stack wrappers so they cannot accidentally delete storage
while the server still runs.
To rebuild only the staging server while retaining objects, use
`terraform/stacks/staging/server/scripts/destroy.sh` instead. The storage stack
can also be managed explicitly with `run-storage-stack.sh staging`.
