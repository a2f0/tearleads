#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TERRAFORM_DIR="$REPO_ROOT/terraform"

errors=0

"$SCRIPT_DIR/checkInfrastructureParity.sh"

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
  local terraform_test_dir
  local terraform_test_status=0

  if ! terraform_test_dir="$(mktemp -d)"; then
    echo "Error: could not create a temporary Terraform test directory" >&2
    return 1
  fi
  if ! cp "$module_dir"/*.tf "$module_dir"/*.tftest.hcl "$terraform_test_dir/"; then
    rm -rf -- "$terraform_test_dir"
    echo "Error: could not stage the Terraform module tests" >&2
    return 1
  fi

  if [[ -f "$module_dir/.terraform.lock.hcl" ]]; then
    cp "$module_dir/.terraform.lock.hcl" "$terraform_test_dir/" || {
      rm -rf -- "$terraform_test_dir"
      echo "Error: could not stage the Terraform provider lock file" >&2
      return 1
    }
  fi

  echo "Running terraform tests in ${module_dir#"$TERRAFORM_DIR"/}..."
  terraform -chdir="$terraform_test_dir" init -backend=false -input=false >/dev/null || terraform_test_status=$?
  if [ "$terraform_test_status" -eq 0 ]; then
    if [[ "$module_dir" == "$TERRAFORM_DIR/stacks/prod/postgres" ]]; then
      terraform -chdir="$terraform_test_dir" test -json -verbose >"$terraform_test_dir/results.jsonl" || terraform_test_status=$?
      jq -r --argjson exit_code "$terraform_test_status" \
        'select(.type != "test_plan" and .type != "test_state" and ($exit_code != 0 or .type != "diagnostic" or .diagnostic.severity != "error")) | .["@message"]' \
        "$terraform_test_dir/results.jsonl"
      if [ "$terraform_test_status" -eq 0 ]; then
        "$SCRIPT_DIR/checkPostgresOutputContract.sh" "$terraform_test_dir/results.jsonl" || terraform_test_status=$?
      fi
    else
      terraform -chdir="$terraform_test_dir" test -no-color || terraform_test_status=$?
    fi
  fi
  rm -rf -- "$terraform_test_dir"
  return "$terraform_test_status"
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
    "$TERRAFORM_DIR/modules/s3-blob-storage" \
    "$TERRAFORM_DIR/stacks/prod/postgres"; do
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
