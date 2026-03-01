#!/usr/bin/env bash
set -euo pipefail

# Terraform linting script
# Runs terraform fmt check and tflint on all terraform directories

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

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
    echo "Run 'terraform -chdir=\"$dir\" fmt -recursive' to fix formatting" >&2
    return 1
  fi
  return 0
}

run_tflint() {
  local dir="$1"
  local abs_dir="$REPO_ROOT/$dir"
  echo "Running tflint in $dir..."
  if ! tflint --chdir="$abs_dir"; then
    echo "Error: tflint failed in $dir" >&2
    return 1
  fi
  return 0
}

run_vault_script_typecheck() {
  echo "Type-checking Vault TypeScript scripts..."
  local scripts_to_check=(
    "terraform/stacks/prod/vault/scripts/fetch-secrets.ts"
    "terraform/stacks/prod/vault/scripts/migrate-secrets.ts"
  )
  if ! (
    cd "$REPO_ROOT" &&
      pnpm exec tsc --pretty false --noEmit \
        --module NodeNext \
        --moduleResolution NodeNext \
        --target ES2022 \
        --allowImportingTsExtensions \
        --types node \
        "${scripts_to_check[@]}"
  ); then
    echo "Error: Vault TypeScript script type-check failed" >&2
    return 1
  fi
  return 0
}

run_vault_script_smoke_checks() {
  local scripts_dir="$REPO_ROOT/terraform/stacks/prod/vault/scripts"
  local scripts_to_check=("fetch-secrets.ts" "migrate-secrets.ts")
  local script
  local missing_dir
  local output

  if [ ! -d "$scripts_dir" ]; then
    echo "Warning: $scripts_dir does not exist, skipping Vault script smoke checks" >&2
    return 0
  fi

  for script in "${scripts_to_check[@]}"; do
    echo "Smoke-checking $script with --help..."
    if ! (cd "$scripts_dir" && "./$script" --help >/dev/null); then
      echo "Error: $script failed when invoked as ./script from $scripts_dir" >&2
      return 1
    fi
  done

  missing_dir="$(mktemp -d /tmp/tearleads-missing-secrets-dir-XXXXXX)"
  rmdir "$missing_dir"

  output="$(
    cd "$scripts_dir"
    if ! ./migrate-secrets.ts --secrets-dir "$missing_dir" 2>&1 >/dev/null; then
      :
    fi
  )"

  case "$output" in
    *"Secrets directory not found:"*)
      ;;
    *)
      echo "Error: migrate-secrets.ts failed with an unexpected error path" >&2
      echo "$output" >&2
      return 1
      ;;
  esac

  return 0
}

# Check for required tools
has_terraform=false
if check_command "terraform"; then
  has_terraform=true
fi

has_tflint=false
if check_command "tflint"; then
  has_tflint=true
fi

if ! $has_terraform && ! $has_tflint; then
  echo "Error: neither terraform nor tflint is installed" >&2
  exit 1
fi

# Run checks on each directory
for dir in "${TERRAFORM_DIRS[@]}"; do
  if [ ! -d "$REPO_ROOT/$dir" ]; then
    echo "Warning: $dir does not exist, skipping" >&2
    continue
  fi

  if $has_terraform; then
    if ! run_terraform_fmt "$dir"; then
      errors=$((errors + 1))
    fi
  fi

  if $has_tflint; then
    if ! run_tflint "$dir"; then
      errors=$((errors + 1))
    fi
  fi
done

if ! run_vault_script_typecheck; then
  errors=$((errors + 1))
fi

if ! run_vault_script_smoke_checks; then
  errors=$((errors + 1))
fi

if [ "$errors" -gt 0 ]; then
  echo "Terraform linting failed with $errors error(s)" >&2
  exit 1
fi

echo "Terraform linting passed"
