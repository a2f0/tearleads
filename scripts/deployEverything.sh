#!/usr/bin/env bash
# Apply both server stacks, build and upload every native release, then deploy
# every server tier.
#
# Runs in order:
#   1. Staging Terraform, server services, and Code Assist
#   2. Staging iOS and Android releases
#   3. Production Terraform, server services, and Code Assist
#   4. Production iOS and Android releases

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

  (
    unset SSH_TARGET
    load_secrets_env "$tier" || exit 1
    if [[ -n "$explicit_target" ]]; then
      export SSH_TARGET="$explicit_target"
    fi
    if [[ -z "${SSH_TARGET:-}" ]]; then
      SSH_TARGET="$(resolve_stack_ssh_target "$stack_dir")" || exit 1
    else
      wait_for_ssh_ready "$SSH_TARGET" >&2 || exit 1
    fi
    printf '%s\n' "$SSH_TARGET"
  )
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
  reject_same_ssh_host_name "$STAGING_SSH_TARGET" "$PRODUCTION_SSH_TARGET"
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
  local ssh_target="$2"
  shift 2

  run_step "$label" env SSH_TARGET="$ssh_target" "$@"
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
run_tier_step "deploy-staging" "$STAGING_EFFECTIVE_SSH_TARGET" \
  "$SCRIPT_DIR/deployStaging.sh" --skip-terraform
run_tier_step "code-assist-staging" "$STAGING_EFFECTIVE_SSH_TARGET" \
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
run_tier_step "deploy-production" "$PRODUCTION_EFFECTIVE_SSH_TARGET" \
  "$SCRIPT_DIR/deployProduction.sh" --skip-terraform
run_tier_step "code-assist-production" "$PRODUCTION_EFFECTIVE_SSH_TARGET" \
  "$REPO_ROOT/packages/code-assist/scripts/deployProductionCodeAssist.sh"
run_step "ios-production" "$SCRIPT_DIR/uploadIosRelease.sh"
run_step "android-production" "$SCRIPT_DIR/uploadAndroidRelease.sh"

echo "=== Everything deployment finished ==="
echo "All steps succeeded."
echo ""
print_timing_summary
