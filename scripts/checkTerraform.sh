#!/usr/bin/env bash
set -euo pipefail

# Terraform linting script
# Runs terraform fmt check and tflint on all terraform directories

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TERRAFORM_DIRS=(
  "terraform"
  "tuxedo/terraform"
)

errors=0

check_command() {
  local cmd="$1"
  if ! command -v "$cmd" &>/dev/null; then
    echo "Warning: $cmd is not installed, skipping $cmd checks" >&2
    return 1
  fi
  return 0
}

run_terraform_fmt() {
  local dir="$1"
  local abs_dir="$REPO_ROOT/$dir"
  echo "Checking terraform fmt in $dir..."
  if ! terraform -chdir="$abs_dir" fmt -check -recursive -diff; then
    echo "Error: terraform fmt check failed in $dir" >&2
    echo "Run 'terraform -chdir=$dir fmt -recursive' to fix formatting" >&2
    return 1
  fi
  return 0
}

run_tflint() {
  local dir="$1"
  local abs_dir="$REPO_ROOT/$dir"
  echo "Running tflint in $dir..."
  if ! tflint --chdir="$abs_dir" --config="$abs_dir/.tflint.hcl"; then
    echo "Error: tflint failed in $dir" >&2
    return 1
  fi
  return 0
}

# Check for required tools
has_terraform=true
has_tflint=true

if ! check_command "terraform"; then
  has_terraform=false
fi

if ! check_command "tflint"; then
  has_tflint=false
fi

if [ "$has_terraform" = false ] && [ "$has_tflint" = false ]; then
  echo "Error: neither terraform nor tflint is installed" >&2
  exit 1
fi

# Run checks on each directory
for dir in "${TERRAFORM_DIRS[@]}"; do
  if [ ! -d "$REPO_ROOT/$dir" ]; then
    echo "Warning: $dir does not exist, skipping" >&2
    continue
  fi

  if [ "$has_terraform" = true ]; then
    if ! run_terraform_fmt "$dir"; then
      errors=$((errors + 1))
    fi
  fi

  if [ "$has_tflint" = true ]; then
    if ! run_tflint "$dir"; then
      errors=$((errors + 1))
    fi
  fi
done

if [ "$errors" -gt 0 ]; then
  echo "Terraform linting failed with $errors error(s)" >&2
  exit 1
fi

echo "Terraform linting passed"
