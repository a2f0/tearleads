# Public Electrobun downloads

Independent downloads stacks own public AWS S3 buckets in `us-east-1` for
Electrobun installers, disk images, and release artifacts.

| Environment | Bucket | Terraform state |
| --- | --- | --- |
| Production | `downloads.tearleads.com` | `prod/downloads/terraform.tfstate` |
| Staging | `downloads-staging.tearleads.com` | `staging/downloads/terraform.tfstate` |

The roots in `terraform/stacks/{prod,staging}/downloads` own the buckets; this
module manages their download policies, ownership, encryption, and upload
cleanup. They are separate from the private `s3-blob-storage` module, storage
state, and server deployment lifecycle.

Anonymous callers can read objects over HTTPS with `s3:GetObject`. Public bucket
listing, uploads, and deletion are not granted. ACLs are disabled, objects use
SSE-S3 encryption, and incomplete multipart uploads are aborted after seven days.
Completed artifacts do not expire. Publishing requires an AWS identity with
write permissions for the relevant bucket; this module does not create uploader
credentials. Upload without a `public-read` ACL because the bucket policy grants
download access.

AWS account or organization Block Public Access settings must permit public
bucket policies (`BlockPublicPolicy` and `RestrictPublicBuckets` must be off).
These stacks configure only bucket-level settings. More restrictive settings
above the bucket override them; see
[AWS Block Public Access](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html).

## Provision

The wrapper loads deployment AWS credentials from `.secrets/root.env`, following
the other Terraform stack wrappers. Plan and apply each environment explicitly:

```sh
umask 077
terraform/scripts/run-downloads-stack.sh staging plan -out="$PWD/.secrets/staging-downloads.tfplan"
terraform/scripts/run-downloads-stack.sh staging apply "$PWD/.secrets/staging-downloads.tfplan"
rm -f "$PWD/.secrets/staging-downloads.tfplan"

terraform/scripts/run-downloads-stack.sh prod plan -out="$PWD/.secrets/prod-downloads.tfplan"
terraform/scripts/run-downloads-stack.sh prod apply "$PWD/.secrets/prod-downloads.tfplan"
rm -f "$PWD/.secrets/prod-downloads.tfplan"
```

Production uses `prevent_destroy = true` and `force_destroy = false`; the wrapper
also rejects `prod destroy`. Staging allows an explicit full teardown with
`terraform/scripts/run-downloads-stack.sh staging destroy`, including its objects.
Server deployment and teardown scripts do not manage these stacks.

## Download URLs

Read the `bucket` output for publishing destinations and `download_base_url` for
anonymous downloads. Append `/` and the URL-encoded object key to the base URL:

```text
https://s3.us-east-1.amazonaws.com/downloads.tearleads.com/<object-key>
https://s3.us-east-1.amazonaws.com/downloads-staging.tearleads.com/<object-key>
```

These are regional path-style URLs because S3's wildcard HTTPS certificate does
not cover bucket names containing dots. See
[AWS S3 URL formats](https://docs.aws.amazon.com/AmazonS3/latest/userguide/VirtualHosting.html).
The domain-shaped bucket names do not configure DNS or custom-domain HTTPS.
Serving `https://downloads.tearleads.com/...` or
`https://downloads-staging.tearleads.com/...` requires a separate TLS frontend
and DNS configuration.
