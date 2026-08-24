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
  local module_dir="$TERRAFORM_DIR/modules/cloudflare-website-cache"
  local terraform_test_dir

  terraform_test_dir="$(mktemp -d)"
  trap 'rm -rf -- "$terraform_test_dir"' RETURN
  cp "$module_dir"/*.tf "$module_dir"/*.tftest.hcl "$terraform_test_dir/"

  echo "Running terraform tests..."
  terraform -chdir="$terraform_test_dir" init -backend=false -input=false >/dev/null
  terraform -chdir="$terraform_test_dir" test -no-color
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
  if ! run_terraform_tests; then
    errors=$((errors + 1))
  fi
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
