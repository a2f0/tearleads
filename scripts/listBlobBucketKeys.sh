#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/listBlobBucketKeys.sh <staging|prod> [prefix] [--with-size]

Lists object keys in the selected tier's S3 blob bucket with the API CLI,
using the credentials the tier's storage Terraform stack issued.
The optional prefix limits the S3 ListObjectsV2 request.
Pass --with-size to prefix each line with the object size as "<size>\t<key>".
EOF
}

main() {
  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    return 0
  fi

  local with_size=""
  local positionals=()
  local arg
  for arg in "$@"; do
    if [[ "$arg" == "--with-size" ]]; then
      with_size="--with-size"
    else
      positionals+=("$arg")
    fi
  done

  local tier="${positionals[0]:-}"
  local prefix="${positionals[1]:-}"
  case "$tier" in
    staging | prod) ;;
    *)
      usage >&2
      return 1
      ;;
  esac
  if [[ ${#positionals[@]} -gt 2 ]]; then
    usage >&2
    return 1
  fi

  local repo_root
  repo_root="$(git rev-parse --show-toplevel)"

  umask 077
  local storage_json
  storage_json="$(mktemp "${TMPDIR:-/tmp}/tearleads-${tier}-storage-XXXXXX")"
  trap 'rm -f "$storage_json"' EXIT
  "$repo_root/terraform/scripts/run-storage-stack.sh" "$tier" output -json api_storage >"$storage_json"

  local cli_args=(blob-store:list-keys)
  if [[ -n "$prefix" ]]; then
    cli_args+=(--prefix "$prefix")
  fi
  if [[ -n "$with_size" ]]; then
    cli_args+=("$with_size")
  fi

  (
    cd "$repo_root/packages/api-cli"
    export BLOB_OBJECT_STORE=s3
    export BLOB_OBJECT_STORE_S3_BUCKET BLOB_OBJECT_STORE_S3_REGION BLOB_OBJECT_STORE_S3_ENDPOINT
    export BLOB_OBJECT_STORE_S3_FORCE_PATH_STYLE BLOB_OBJECT_STORE_S3_ACCESS_KEY_ID
    export BLOB_OBJECT_STORE_S3_SECRET_ACCESS_KEY BLOB_OBJECT_STORE_S3_KEY_PREFIX
    BLOB_OBJECT_STORE_S3_BUCKET="$(jq -r '.blob_s3_bucket' "$storage_json")"
    BLOB_OBJECT_STORE_S3_REGION="$(jq -r '.blob_s3_region' "$storage_json")"
    BLOB_OBJECT_STORE_S3_ENDPOINT="$(jq -r '.blob_s3_endpoint // ""' "$storage_json")"
    BLOB_OBJECT_STORE_S3_FORCE_PATH_STYLE="$(jq -r '.blob_s3_force_path_style' "$storage_json")"
    BLOB_OBJECT_STORE_S3_ACCESS_KEY_ID="$(jq -r '.blob_s3_access_key_id' "$storage_json")"
    BLOB_OBJECT_STORE_S3_SECRET_ACCESS_KEY="$(jq -r '.blob_s3_secret_access_key' "$storage_json")"
    BLOB_OBJECT_STORE_S3_KEY_PREFIX="$(jq -r '.blob_s3_key_prefix // ""' "$storage_json")"
    exec bun src/index.ts "${cli_args[@]}"
  )
}

main "$@"
