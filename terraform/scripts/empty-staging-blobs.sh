#!/usr/bin/env bash
# Called after the staging Worker is deleted; R2 refuses nonempty bucket deletion.
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
if [[ $# -ne 0 ]]; then echo "Usage: $(basename "$0")" >&2; exit 1; fi
# Never trace runtime credentials read from the sensitive Terraform output.
set +x
umask 077
STORAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STORAGE_DIR"' EXIT
"$REPO_ROOT/terraform/scripts/run-storage-stack.sh" staging output -json api_storage >"$STORAGE_DIR/storage.json"
BUCKET="$(jq -er '.blob_s3_bucket' "$STORAGE_DIR/storage.json")"
ENDPOINT="$(jq -er '.blob_s3_endpoint' "$STORAGE_DIR/storage.json")"
if [[ "$BUCKET" != tearleads-blobs-staging || ! "$ENDPOINT" =~ ^https://[a-f0-9]{32}\.r2\.cloudflarestorage\.com$ ]]; then
  echo "ERROR: Refusing to empty an unexpected staging R2 bucket." >&2
  exit 1
fi
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
AWS_ACCESS_KEY_ID="$(jq -er '.blob_s3_access_key_id' "$STORAGE_DIR/storage.json")"
AWS_SECRET_ACCESS_KEY="$(jq -er '.blob_s3_secret_access_key' "$STORAGE_DIR/storage.json")"
unset AWS_SESSION_TOKEN AWS_SECURITY_TOKEN AWS_PROFILE AWS_DEFAULT_PROFILE
r2() { aws --endpoint-url "$ENDPOINT" --region auto "$@"; }
r2 s3 rm "s3://$BUCKET/" --recursive --only-show-errors
r2 s3api list-multipart-uploads --bucket "$BUCKET" --output json >"$STORAGE_DIR/uploads.json"
jq -c '.Uploads[]?' "$STORAGE_DIR/uploads.json" >"$STORAGE_DIR/uploads.ndjson"
while IFS= read -r upload; do
  key="$(jq -er '.Key' <<<"$upload")"
  upload_id="$(jq -er '.UploadId' <<<"$upload")"
  r2 s3api abort-multipart-upload --bucket "$BUCKET" --key "$key" --upload-id "$upload_id"
done <"$STORAGE_DIR/uploads.ndjson"
r2 s3api list-objects-v2 --bucket "$BUCKET" --output json >"$STORAGE_DIR/objects.json"
r2 s3api list-multipart-uploads --bucket "$BUCKET" --output json >"$STORAGE_DIR/uploads.json"
jq -e '(.Contents // []) | length == 0' "$STORAGE_DIR/objects.json" >/dev/null
jq -e '(.Uploads // []) | length == 0' "$STORAGE_DIR/uploads.json" >/dev/null
echo "Staging R2 blob bucket is empty."
