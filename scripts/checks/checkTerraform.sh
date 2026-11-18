#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TERRAFORM_DIR="$REPO_ROOT/terraform"

errors=0

"$SCRIPT_DIR/checkInfrastructureParity.sh"
bash "$SCRIPT_DIR/checkDownloadsDeployment.sh"

check_command() {
  local cmd="$1"
  if ! command -v "$cmd" &>/dev/null; then
    echo "Warning: $cmd is not installed, skipping $cmd checks" >&2
    return 1
  fi
  return 0
}

run_terraform_fmt() {
  echo "Checking terraform fmt..."
  if ! terraform -chdir="$TERRAFORM_DIR" fmt -check -recursive -diff; then
    echo "Error: terraform fmt check failed" >&2
    echo "Run 'terraform -chdir=terraform fmt -recursive' to fix formatting" >&2
    return 1
  fi
  return 0
}

run_terraform_tests() {
  local module_dir="$1"
  local terraform_test_root terraform_test_dir
  local terraform_test_status=0

  if ! terraform_test_root="$(mktemp -d)"; then
    echo "Error: could not create a temporary Terraform test directory" >&2
    return 1
  fi
  terraform_test_dir="$terraform_test_root"
  if [[ "$module_dir" == "$TERRAFORM_DIR/stacks/"* ]]; then
    terraform_test_dir="$terraform_test_root/${module_dir#"$TERRAFORM_DIR"/}"
    if ! mkdir -p "$terraform_test_dir" ||
      ! ln -s "$TERRAFORM_DIR/modules" "$terraform_test_root/modules"; then
      rm -rf -- "$terraform_test_root"
      echo "Error: could not stage the Terraform stack module paths" >&2
      return 1
    fi
  fi
  if ! cp "$module_dir"/*.tf "$module_dir"/*.tftest.hcl "$terraform_test_dir/"; then
    rm -rf -- "$terraform_test_root"
    echo "Error: could not stage the Terraform module tests" >&2
    return 1
  fi

  if [[ -f "$module_dir/.terraform.lock.hcl" ]]; then
    cp "$module_dir/.terraform.lock.hcl" "$terraform_test_dir/" || {
      rm -rf -- "$terraform_test_root"
      echo "Error: could not stage the Terraform provider lock file" >&2
      return 1
    }
  fi

  echo "Running terraform tests in ${module_dir#"$TERRAFORM_DIR"/}..."
  terraform -chdir="$terraform_test_dir" init -backend=false -input=false >/dev/null || terraform_test_status=$?
  if [ "$terraform_test_status" -eq 0 ]; then
    terraform -chdir="$terraform_test_dir" test -no-color || terraform_test_status=$?
  fi
  if [[ "$terraform_test_status" == 0 && "$module_dir" == "$TERRAFORM_DIR/stacks/prod/website" ]]; then
    check_verification_retention "$module_dir" "$terraform_test_dir" || terraform_test_status=$?
  fi
  rm -rf -- "$terraform_test_root"
  return "$terraform_test_status"
}

# Terraform test's expect_failures handles custom conditions, but cannot
# match a lifecycle.prevent_destroy diagnostic. Exercise the enrolled state
# with the mocked provider and require destruction errors for both TXT records.
check_verification_retention() {
  local module_dir="$1" test_dir="$2" result
  cp -R "$module_dir/negative" "$test_dir/" || return 1
  if result="$(terraform -chdir="$test_dir" test -no-color -test-directory=negative \
    -filter=negative/retention.tftest.hcl 2>&1)"; then
    echo "ERROR: A plan removed the enrolled Balebase verification record." >&2
    return 1
  fi
  if [[ "$result" != *'run "enroll"... pass'* ||
        "$result" != *'run "omit_input"... fail'* ||
        "$result" != *'Resource cloudflare_dns_record.balebase_verification[0] has'* ||
        "$result" != *'Resource cloudflare_dns_record.balebase_subdomain_verification[0] has'* ||
        "$(grep -c 'lifecycle.prevent_destroy set' <<<"$result")" != 2 ||
        "$(grep -c '^Error:' <<<"$result")" != 2 ]]; then
    echo "$result" >&2
    return 1
  fi
  echo "Verified that both enrolled Balebase TXT records survive omitted settings."
}

run_tflint() {
  echo "Running tflint..."
  tflint --init --chdir="$TERRAFORM_DIR"
  if ! tflint --chdir="$TERRAFORM_DIR"; then
    echo "Error: tflint failed" >&2
    return 1
  fi
  return 0
}

# HCL file format check (terraform fmt)
if check_command terraform; then
  if ! run_terraform_fmt; then
    errors=$((errors + 1))
  fi
  for module_dir in \
    "$TERRAFORM_DIR/modules/cloudflare-website" \
    "$TERRAFORM_DIR/modules/r2-object-storage" \
    "$TERRAFORM_DIR/stacks/prod/continuity" \
    "$TERRAFORM_DIR/stacks/prod/postgres" \
    "$TERRAFORM_DIR/stacks/prod/website" \
    "$TERRAFORM_DIR/stacks/staging/postgres"; do
    if ! run_terraform_tests "$module_dir"; then
      errors=$((errors + 1))
    fi
  done
fi

# TFLint rules
if check_command tflint; then
  if ! run_tflint; then
    errors=$((errors + 1))
  fi
fi

if [ "$errors" -gt 0 ]; then
  echo "terraform linting failed with $errors error(s)" >&2
  exit 1
fi

echo "terraform linting passed"
