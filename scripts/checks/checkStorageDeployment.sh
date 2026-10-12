#!/usr/bin/env bash
# Lifecycle prevent_destroy is not exposed as a Terraform test assertion.
# Check the formatted root resource blocks independently of the shared module.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
for tier in prod staging; do
  stack="$REPO_ROOT/terraform/stacks/$tier/storage"
  bucket_config=$(sed -n '/^resource "cloudflare_r2_bucket" "blobs" {$/,/^}$/p' "$stack/main.tf")
  configured_bucket=$(sed -n 's/^[[:space:]]*name[[:space:]]*=[[:space:]]*"\([^" ]*\)"$/\1/p' <<<"$bucket_config")
  if [[ "$configured_bucket" != "tearleads-blobs-$tier" ]] ||
    ! grep -Eq '^[[:space:]]*account_id[[:space:]]*=[[:space:]]*var.cloudflare_account_id$' <<<"$bucket_config" ||
    ! grep -Eq '^[[:space:]]*location[[:space:]]*=[[:space:]]*"enam"$' <<<"$bucket_config"; then
    echo "ERROR: $tier storage must use its own R2 bucket in the configured account." >&2
    exit 1
  fi
  lifecycle_config=$(sed -n '/^  lifecycle {$/,/^  }$/p' <<<"$bucket_config")
  if [[ "$tier" == prod ]]; then
    if ! grep -Eq '^[[:space:]]*prevent_destroy[[:space:]]*=[[:space:]]*true$' <<<"$lifecycle_config"; then
      echo "ERROR: Production storage must prevent bucket destruction." >&2
      exit 1
    fi
  elif grep -Eq '^[[:space:]]*prevent_destroy[[:space:]]*=[[:space:]]*true$' <<<"$lifecycle_config"; then
    echo "ERROR: Staging storage must permit a full teardown." >&2
    exit 1
  fi
done

echo "Storage deployment lifecycle checks passed."
