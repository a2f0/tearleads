# Cloudflare R2 object storage

The environment stacks own four independent buckets:

| Tier | Private blobs | Public desktop downloads |
| --- | --- | --- |
| Production | `tearleads-blobs-prod` | `tearleads-downloads-prod` |
| Staging | `tearleads-blobs-staging` | `tearleads-downloads-staging` |

This module disables the `r2.dev` endpoint, aborts incomplete multipart uploads
after seven days, and creates one account token scoped to object access in its
bucket. Only downloads receive a custom domain: `downloads.tearleads.com` or
`downloads-staging.tearleads.com`. Application blobs have no public endpoint.
Production roots retain `prevent_destroy`; R2 requires empty buckets before
deletion in either tier. Terraform state lives in the separate
`tearleads-terraform-state` bucket, which no stack manages.

Private blob roots set `download_cors_origins = ["*"]` for cross-origin signed
GETs and PUTs from web, desktop, and mobile clients. CORS does not grant object
access:
the API authorizes each transfer and issues five-minute bearer URLs. The rule
permits GET and PUT, allows Content-MD5 and Content-Type, and exposes length,
range, and ETag headers. It does not enable a public domain. Apply storage CORS
before deploying direct-transfer clients. The existing Terraform resource
address is retained so this rule updates in place.
Other module callers omit CORS management by default.

The Terraform token needs Workers R2 Storage Write, Account API Tokens Write,
and zone read access for the download domains. Runtime tokens cannot administer
buckets or access another bucket. Terraform stores their sensitive values in
the backend; never print `api_storage` or `release_storage` outputs to logs.

## Provision and deploy

Use `terraform/scripts/run-storage-stack.sh` and `run-downloads-stack.sh` with
`staging` or `prod`, inspect `plan -out=<private-plan>`, then apply that plan.
The API deployment takes bucket, endpoint, region, and credentials from
`api_storage`. Desktop publication reads `release_storage` immediately before
uploading. The `BLOB_OBJECT_STORE=s3` setting names R2's supported wire protocol;
the same adapter talks to LocalStack during local development. There is no AWS
fallback, object copy on read, or dual write in the deployed application.

R2 uses region `auto` and `https://<account-id>.r2.cloudflarestorage.com`.
The account token ID is the access key; SHA-256 of its value is the secret key.
See [Cloudflare authentication](https://developers.cloudflare.com/r2/api/tokens/)
and [S3 API support](https://developers.cloudflare.com/r2/api/s3/api/).

## Multipart encryption

The SDK encrypts fixed 5 MiB plaintext chunks, then partitions the resulting
binary envelope independently for upload. All nonfinal transport parts have
the same size: one full encrypted chunk plus the header length. This satisfies
[R2's multipart limits](https://developers.cloudflare.com/r2/objects/upload-objects/#multipart-upload-details)
and keeps the maximum supported envelope within 10,000 parts. Uploads and
retries read bounded source chunks and preserve the envelope's bytes and hash.
The client validates each part's SHA-256, obtains a five-minute UploadPart URL
(from the stage initiation for the parts it starts with, and just in time for
every later part or retry), and sends the bytes directly with a signed
`Content-MD5` and body length.
Each URL authorizes one part of the same upload ID; new URLs for later parts or
retries preserve earlier ETags. Uploads may span more than five minutes, within
the existing one-hour staging lifetime. The API rejects S3/R2 byte proxy uploads.
Automatic SDK flexible checksums are disabled: R2 rejects the multipart
`x-amz-checksum-sha256` header. Completion streams the whole object to
verify the application's flat SHA-256 digest. It does not substitute an R2
composite checksum for that digest.

The greenfield cutover discards old application blobs and retires the AWS
buckets, policies, IAM users, and keys using their original Terraform state.
Do not apply new storage configuration over old nonempty resources: follow the
[reset runbook](../../../docs/developer/greenfield-reset.md), using the old
configuration for its teardown, then provision these roots from empty state.
Download buckets are rebuilt and populated by fresh desktop releases during
this cutover. Subsequent application resets retain the R2 downloads.
