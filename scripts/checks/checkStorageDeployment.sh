#!/usr/bin/env bash
# Lifecycle prevent_destroy is not exposed as a Terraform test assertion.
# Check the formatted root resource blocks independently of the shared module.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
for tier in prod staging; do
  stack="$REPO_ROOT/terraform/stacks/$tier/storage"
  bucket_config=$(sed -n '/^resource "aws_s3_bucket" "blobs" {$/,/^}$/p' "$stack/main.tf")
  force_destroy=true
  [[ "$tier" != prod ]] || force_destroy=false
  if ! grep -Eq "^[[:space:]]*bucket[[:space:]]*=[[:space:]]*\"tearleads-$tier\"$" <<<"$bucket_config" ||
    ! grep -Eq "^[[:space:]]*force_destroy[[:space:]]*=[[:space:]]*$force_destroy$" <<<"$bucket_config" ||
    ! grep -Eq '^[[:space:]]*region[[:space:]]*=[[:space:]]*"us-east-1"$' "$stack/versions.tf"; then
    echo "ERROR: $tier storage must use its own us-east-1 bucket and the tier's deletion policy." >&2
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
