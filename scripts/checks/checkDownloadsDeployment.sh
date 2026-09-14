#!/usr/bin/env bash
# Lifecycle prevent_destroy is not exposed as a Terraform test assertion.
# Check the formatted root resource blocks independently of the shared module.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
for tier in prod staging; do
  stack="$REPO_ROOT/terraform/stacks/$tier/downloads"
  bucket_config=$(sed -n '/^resource "aws_s3_bucket" "downloads" {$/,/^}$/p' "$stack/main.tf")
  bucket_name=downloads-staging.tearleads.com
  [[ "$tier" != prod ]] || bucket_name=downloads.tearleads.com
  force_destroy=true
  [[ "$tier" != prod ]] || force_destroy=false
  configured_bucket=$(sed -n 's/^[[:space:]]*bucket[[:space:]]*=[[:space:]]*"\([^" ]*\)"$/\1/p' <<<"$bucket_config")
  if [[ "$configured_bucket" != "$bucket_name" ]] ||
    ! grep -Eq "^[[:space:]]*force_destroy[[:space:]]*=[[:space:]]*$force_destroy$" <<<"$bucket_config" ||
    ! grep -Eq '^[[:space:]]*region[[:space:]]*=[[:space:]]*"us-east-1"$' "$stack/versions.tf"; then
    echo "ERROR: $tier downloads must use its own us-east-1 bucket and the tier's deletion policy." >&2
    exit 1
  fi
  lifecycle_config=$(sed -n '/^  lifecycle {$/,/^  }$/p' <<<"$bucket_config")
  if [[ "$tier" == prod ]]; then
    if ! grep -Eq '^[[:space:]]*prevent_destroy[[:space:]]*=[[:space:]]*true$' <<<"$lifecycle_config"; then
      echo "ERROR: Production downloads must prevent bucket destruction." >&2
      exit 1
    fi
  elif grep -Eq '^[[:space:]]*prevent_destroy[[:space:]]*=[[:space:]]*true$' <<<"$lifecycle_config"; then
    echo "ERROR: Staging downloads must permit a full teardown." >&2
    exit 1
  fi
done

echo "Downloads deployment lifecycle checks passed."
