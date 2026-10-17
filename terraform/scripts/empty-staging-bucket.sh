#!/usr/bin/env bash
# Called after the staging Workers are deleted; R2 refuses nonempty bucket deletion.
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
# Each R2 stack names its own bucket and output; map both to one connection shape.
case "${1:-}:$#" in
  storage:1)
    EXPECTED_BUCKET=tearleads-blobs-staging
    CONNECTION_FILTER='.api_storage.value | {bucket: .blob_s3_bucket,
      endpoint: .blob_s3_endpoint, access_key_id: .blob_s3_access_key_id,
      secret_access_key: .blob_s3_secret_access_key}'
    ;;
  downloads:1)
    EXPECTED_BUCKET=tearleads-downloads-staging
    CONNECTION_FILTER='.release_storage.value'
    ;;
  *) echo "Usage: $(basename "$0") <storage|downloads>" >&2; exit 1 ;;
esac
STACK="$1"
# Never trace runtime credentials read from the sensitive Terraform output.
set +x
umask 077
STORAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STORAGE_DIR"' EXIT
"$REPO_ROOT/terraform/scripts/run-$STACK-stack.sh" staging output -json >"$STORAGE_DIR/outputs.json"
if jq -e '. == {}' "$STORAGE_DIR/outputs.json" >/dev/null; then
  echo "Staging $STACK has no outputs; there is no configured bucket to empty."
  exit 0
fi
jq -e "$CONNECTION_FILTER" "$STORAGE_DIR/outputs.json" >"$STORAGE_DIR/storage.json"
BUCKET="$(jq -er '.bucket' "$STORAGE_DIR/storage.json")"
ENDPOINT="$(jq -er '.endpoint' "$STORAGE_DIR/storage.json")"
if [[ "$BUCKET" != "$EXPECTED_BUCKET" || ! "$ENDPOINT" =~ ^https://[a-f0-9]{32}\.r2\.cloudflarestorage\.com$ ]]; then
  echo "ERROR: Refusing to empty an unexpected staging R2 bucket." >&2
  exit 1
fi
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
AWS_ACCESS_KEY_ID="$(jq -er '.access_key_id' "$STORAGE_DIR/storage.json")"
AWS_SECRET_ACCESS_KEY="$(jq -er '.secret_access_key' "$STORAGE_DIR/storage.json")"
unset AWS_SESSION_TOKEN AWS_SECURITY_TOKEN AWS_PROFILE AWS_DEFAULT_PROFILE
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
r2() { aws --endpoint-url "$ENDPOINT" --region auto "$@"; }
# Write one bucket listing to "$STORAGE_DIR/<command>.json". The AWS CLI prints
# nothing for some empty listings: a failed command still aborts the script,
# while empty output from a successful one reads as an empty listing.
r2_list() {
  r2 s3api "$1" --bucket "$BUCKET" --output json >"$STORAGE_DIR/$1.raw"
  jq -s 'if length == 0 then {} elif length == 1 and (.[0] | type) == "object" then .[0] else error("unexpected listing output") end' \
    "$STORAGE_DIR/$1.raw" >"$STORAGE_DIR/$1.json"
}
r2 s3 rm "s3://$BUCKET/" --recursive --only-show-errors
# AWS CLI automatically retrieves every page; do not disable pagination.
r2_list list-multipart-uploads
jq -c '.Uploads[]?' "$STORAGE_DIR/list-multipart-uploads.json" >"$STORAGE_DIR/uploads.ndjson"
while IFS= read -r upload; do
  key="$(jq -er '.Key' <<<"$upload")"
  upload_id="$(jq -er '.UploadId' <<<"$upload")"
  r2 s3api abort-multipart-upload --bucket "$BUCKET" --key "$key" --upload-id "$upload_id"
done <"$STORAGE_DIR/uploads.ndjson"
r2_list list-objects-v2
r2_list list-multipart-uploads
if ! jq -e '(.Contents // []) | length == 0' "$STORAGE_DIR/list-objects-v2.json" >/dev/null; then
  echo "ERROR: Staging R2 bucket still contains objects; refusing teardown." >&2
  exit 1
fi
if ! jq -e '(.Uploads // []) | length == 0' "$STORAGE_DIR/list-multipart-uploads.json" >/dev/null; then
  echo "ERROR: Staging R2 bucket still contains multipart uploads; refusing teardown." >&2
  exit 1
fi
echo "Staging R2 $STACK bucket is empty."
