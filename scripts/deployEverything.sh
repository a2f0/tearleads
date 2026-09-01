#!/usr/bin/env bash
# Apply both server stacks, build and upload every native release, then deploy
# every server tier.
#
# Runs in order:
#   1. Read existing stack targets and verify known destinations are distinct
#   2. Staging Terraform, server services, Code Assist, and native releases
#   3. Production Terraform, server services, Code Assist, and native releases

set -euo pipefail

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
REPO_ROOT="$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd -P)"

usage() {
  cat <<EOF
Usage: $(basename "$0")

Deploys and publishes every staging target before promoting the same release
to production. Terraform, Ansible, server applications, the separately
released Code Assist service, and both native stores are included.

Options:
  -h, --help    Show this help and exit.

Environment:
  STAGING_SSH_TARGET     Optional explicit SSH target for staging.
  PRODUCTION_SSH_TARGET  Optional explicit SSH target for production.

The generic SSH_TARGET variable is rejected because one value cannot safely
select both deployment tiers.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -n "${SSH_TARGET:-}" ]]; then
  echo "Error: SSH_TARGET cannot select both deployment tiers." >&2
  echo "Use STAGING_SSH_TARGET and PRODUCTION_SSH_TARGET instead." >&2
  exit 1
fi

cd "$REPO_ROOT"

# shellcheck source=../terraform/scripts/common.sh
# shellcheck disable=SC1091
. "$REPO_ROOT/terraform/scripts/common.sh"

resolve_tier_ssh_target() {
  local tier="$1"
  local explicit_target="$2"
  local stack_dir="$REPO_ROOT/terraform/stacks/$tier/server"
  local effective_target
  local SSH_TARGET=""

  load_secrets_env "$tier" || return 1
  effective_target="${explicit_target:-${SSH_TARGET:-}}"
  if [[ -z "$effective_target" ]]; then
    effective_target="$(resolve_stack_ssh_target "$stack_dir")" || return 1
  else
    wait_for_ssh_ready "$effective_target" >&2 || return 1
  fi
  printf '%s\n' "$effective_target"
}

read_tier_ssh_target() {
  local tier="$1"
  local explicit_target="$2"
  local stack_dir="$REPO_ROOT/terraform/stacks/$tier/server"
  local backend_config
  local effective_target
  local SSH_TARGET=""

  load_secrets_env "$tier" || return 1
  effective_target="${explicit_target:-${SSH_TARGET:-}}"
  if [[ -n "$effective_target" ]]; then
    printf '%s\n' "$effective_target"
    return 0
  fi

  validate_aws_env || return 1
  backend_config="$(get_backend_config)" || return 1
  terraform -chdir="$stack_dir" init -backend-config="$backend_config" >&2 || return 1
  read_stack_ssh_target "$stack_dir"
}

ssh_target_literal_host() {
  local host="${1##*@}"
  host="${host#[}"
  host="${host%]}"
  host="${host%.}"
  printf '%s\n' "$host" | tr '[:upper:]' '[:lower:]'
}

ssh_target_configured_host() {
  local target="$1"
  local host
  host="$(ssh -G "$target" 2>/dev/null | awk '$1 == "hostname" { print $2; exit }')" || host=""
  if [[ -z "$host" ]]; then
    host="$(ssh_target_literal_host "$target")"
  fi
  ssh_target_literal_host "$host"
}

resolve_ssh_host_addresses() {
  local host="$1"
  DEPLOY_EVERYTHING_RESOLVE_HOST="$host" bun -e '
    const { lookup } = require("node:dns").promises;
    const host = process.env.DEPLOY_EVERYTHING_RESOLVE_HOST;
    const values = await lookup(host, { all: true, verbatim: true });
    const addresses = [...new Set(values.map(({ address }) => address))];
    console.log(addresses.sort().join("\n"));
  '
}

ssh_address_sets_intersect() {
  local left="$1"
  local right="$2"
  local left_address right_address

  while IFS= read -r left_address; do
    [[ -z "$left_address" ]] && continue
    while IFS= read -r right_address; do
      [[ -z "$right_address" ]] && continue
      [[ "$left_address" == "$right_address" ]] && return 0
    done <<< "$right"
  done <<< "$left"
  return 1
}

reject_same_ssh_host_name() {
  local staging_target="$1"
  local production_target="$2"

  if [[ "$(ssh_target_literal_host "$staging_target")" == "$(ssh_target_literal_host "$production_target")" ]]; then
    echo "Error: staging and production resolve to the same SSH host:" >&2
    echo "  staging: $staging_target" >&2
    echo "  production: $production_target" >&2
    exit 1
  fi
}

reject_shared_ssh_host() {
  local staging_target="$1"
  local production_target="$2"
  local staging_host production_host staging_addresses production_addresses

  staging_host="$(ssh_target_configured_host "$staging_target")" || exit 1
  production_host="$(ssh_target_configured_host "$production_target")" || exit 1
  if [[ "$staging_host" == "$production_host" ]]; then
    reject_same_ssh_host_name "$staging_target" "$production_target"
  fi
  staging_addresses="$(resolve_ssh_host_addresses "$staging_host")" || {
    echo "Error: could not resolve staging SSH host: $staging_host" >&2
    exit 1
  }
  if [[ -z "$staging_addresses" ]]; then
    echo "Error: staging SSH host has no resolved addresses: $staging_host" >&2
    exit 1
  fi
  production_addresses="$(resolve_ssh_host_addresses "$production_host")" || {
    echo "Error: could not resolve production SSH host: $production_host" >&2
    exit 1
  }
  if [[ -z "$production_addresses" ]]; then
    echo "Error: production SSH host has no resolved addresses: $production_host" >&2
    exit 1
  fi
  if ssh_address_sets_intersect "$staging_addresses" "$production_addresses"; then
    echo "Error: staging and production SSH hosts resolve to the same address:" >&2
    echo "  staging: $staging_target" >&2
    echo "  production: $production_target" >&2
    exit 1
  fi
}

if [[ -n "${STAGING_SSH_TARGET:-}" && -n "${PRODUCTION_SSH_TARGET:-}" ]]; then
  reject_shared_ssh_host "$STAGING_SSH_TARGET" "$PRODUCTION_SSH_TARGET"
fi

STAGING_PREFLIGHT_STATUS=0
STAGING_PREFLIGHT_SSH_TARGET="$(
  read_tier_ssh_target staging "${STAGING_SSH_TARGET:-}"
)" || STAGING_PREFLIGHT_STATUS=$?
if [[ "$STAGING_PREFLIGHT_STATUS" -ne 0 && "$STAGING_PREFLIGHT_STATUS" -ne 2 ]]; then
  exit "$STAGING_PREFLIGHT_STATUS"
fi

PRODUCTION_PREFLIGHT_STATUS=0
PRODUCTION_PREFLIGHT_SSH_TARGET="$(
  read_tier_ssh_target prod "${PRODUCTION_SSH_TARGET:-}"
)" || PRODUCTION_PREFLIGHT_STATUS=$?
if [[ "$PRODUCTION_PREFLIGHT_STATUS" -ne 0 && "$PRODUCTION_PREFLIGHT_STATUS" -ne 2 ]]; then
  exit "$PRODUCTION_PREFLIGHT_STATUS"
fi

if [[ -n "$STAGING_PREFLIGHT_SSH_TARGET" && -n "$PRODUCTION_PREFLIGHT_SSH_TARGET" ]]; then
  reject_shared_ssh_host \
    "$STAGING_PREFLIGHT_SSH_TARGET" "$PRODUCTION_PREFLIGHT_SSH_TARGET"
fi

DEPLOY_START="$SECONDS"
STEP_TIMINGS=()

format_duration() {
  local total="$1"
  printf '%dm%02ds' "$((total / 60))" "$((total % 60))"
}

run_step() {
  local label="$1"
  shift

  echo "=== [$label] $* ==="
  local step_start="$SECONDS"
  "$@"
  local elapsed="$((SECONDS - step_start))"
  STEP_TIMINGS+=("$(printf '%-20s %s' "$label" "$(format_duration "$elapsed")")")
  echo "[$label] done in $(format_duration "$elapsed")."
  echo ""
}

run_tier_step() {
  local label="$1"
  local tier="$2"
  local ssh_target="$3"
  local target_variable
  shift 3

  case "$tier" in
    staging) target_variable="STAGING_SSH_TARGET" ;;
    prod) target_variable="PRODUCTION_SSH_TARGET" ;;
  esac
  run_step "$label" env "$target_variable=$ssh_target" "$@"
}

print_timing_summary() {
  echo "--- Timing summary ---"
  local row
  for row in "${STEP_TIMINGS[@]+"${STEP_TIMINGS[@]}"}"; do
    echo "  $row"
  done
  echo "  ----------------------------"
  printf '  %-20s %s\n' "total" "$(format_duration "$((SECONDS - DEPLOY_START))")"
}

echo "=== Tearleads Everything Deployment ==="
echo ""

run_step "terraform-staging" \
  "$REPO_ROOT/terraform/stacks/staging/server/scripts/apply.sh" --auto-approve
STAGING_EFFECTIVE_SSH_TARGET="$(
  resolve_tier_ssh_target staging "${STAGING_SSH_TARGET:-}"
)"
if [[ -n "$PRODUCTION_PREFLIGHT_SSH_TARGET" ]]; then
  reject_shared_ssh_host \
    "$STAGING_EFFECTIVE_SSH_TARGET" "$PRODUCTION_PREFLIGHT_SSH_TARGET"
fi

run_tier_step "deploy-staging" staging "$STAGING_EFFECTIVE_SSH_TARGET" \
  "$SCRIPT_DIR/deployStaging.sh" --skip-terraform
run_tier_step "code-assist-staging" staging "$STAGING_EFFECTIVE_SSH_TARGET" \
  "$REPO_ROOT/packages/code-assist/scripts/deployStagingCodeAssist.sh"
run_step "ios-staging" "$SCRIPT_DIR/uploadIosStagingRelease.sh"
run_step "android-staging" "$SCRIPT_DIR/uploadAndroidStagingRelease.sh"

run_step "terraform-production" \
  "$REPO_ROOT/terraform/stacks/prod/server/scripts/apply.sh" --auto-approve
PRODUCTION_EFFECTIVE_SSH_TARGET="$(
  resolve_tier_ssh_target prod "${PRODUCTION_SSH_TARGET:-}"
)"
reject_shared_ssh_host \
  "$STAGING_EFFECTIVE_SSH_TARGET" "$PRODUCTION_EFFECTIVE_SSH_TARGET"
run_tier_step "deploy-production" prod "$PRODUCTION_EFFECTIVE_SSH_TARGET" \
  "$SCRIPT_DIR/deployProduction.sh" --skip-terraform
run_tier_step "code-assist-production" prod "$PRODUCTION_EFFECTIVE_SSH_TARGET" \
  "$REPO_ROOT/packages/code-assist/scripts/deployProductionCodeAssist.sh"
run_step "ios-production" "$SCRIPT_DIR/uploadIosRelease.sh"
run_step "android-production" "$SCRIPT_DIR/uploadAndroidRelease.sh"

echo "=== Everything deployment finished ==="
echo "All steps succeeded."
echo ""
print_timing_summary
