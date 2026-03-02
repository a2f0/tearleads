#!/bin/bash

decode_base64() {
  if base64 --decode >/dev/null 2>&1 <<< "QQ=="; then
    base64 --decode
    return 0
  fi

  if base64 -d >/dev/null 2>&1 <<< "QQ=="; then
    base64 -d
    return 0
  fi

  base64 -D
}

get_secret_key_or_fail() {
  local key="$1"
  local encoded
  encoded="$(kubectl -n "$NAMESPACE" get secret "$SECRET_NAME" -o "jsonpath={.data.$key}" 2>/dev/null || true)"

  if [[ -z "$encoded" ]]; then
    echo "ERROR: Missing key $key in secret $SECRET_NAME."
    exit 1
  fi

  printf '%s' "$encoded" | decode_base64
}

assert_s3_secret_sync_with_env() {
  local hint_text="${1:-Re-apply rendered secrets and retry:}"

  if [[ -n "${VFS_BLOB_S3_ACCESS_KEY_ID:-}" && "${VFS_BLOB_S3_ACCESS_KEY_ID}" != "$access_key" ]]; then
    echo "ERROR: Kubernetes secret $SECRET_NAME has a different VFS_BLOB_S3_ACCESS_KEY_ID than .secrets/staging.env."
    echo "$hint_text"
    echo "  $SCRIPT_DIR/deploy.sh"
    exit 1
  fi

  if [[ -n "${VFS_BLOB_S3_SECRET_ACCESS_KEY:-}" && "${VFS_BLOB_S3_SECRET_ACCESS_KEY}" != "$secret_key" ]]; then
    echo "ERROR: Kubernetes secret $SECRET_NAME has a different VFS_BLOB_S3_SECRET_ACCESS_KEY than .secrets/staging.env."
    echo "$hint_text"
    echo "  $SCRIPT_DIR/deploy.sh"
    exit 1
  fi
}

print_missing_garage_key_hint() {
  echo "Garage does not recognize the configured S3 access key."
  echo "Re-run Garage bootstrap and wait for it to complete:"
  echo "  kubectl -n $NAMESPACE delete job garage-setup --ignore-not-found"
  echo "  kubectl -n $NAMESPACE apply -f \"$SCRIPT_DIR/../manifests/garage.yaml\""
  echo "  kubectl -n $NAMESPACE wait --for=condition=complete job/garage-setup --timeout=180s"
}
