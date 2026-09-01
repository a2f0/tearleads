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

ssh_target_host() {
  local host="${1##*@}"
  host="${host#[}"
  host="${host%]}"
  host="${host%.}"
  printf '%s\n' "$host" | tr '[:upper:]' '[:lower:]'
}

reject_shared_ssh_host() {
  local staging_target="$1"
  local production_target="$2"

  if [[ "$(ssh_target_host "$staging_target")" == "$(ssh_target_host "$production_target")" ]]; then
    echo "Error: staging and production resolve to the same SSH host:" >&2
    echo "  staging: $staging_target" >&2
    echo "  production: $production_target" >&2
    exit 1
  fi
}

if [[ -n "${STAGING_SSH_TARGET:-}" && -n "${PRODUCTION_SSH_TARGET:-}" ]]; then
  reject_shared_ssh_host "$STAGING_SSH_TARGET" "$PRODUCTION_SSH_TARGET"
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
