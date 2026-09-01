#!/usr/bin/env bash
# Full production deployment for Tearleads
#
# Runs in order:
#   1. terraform apply (production server stack)
#   2. ansible playbook (server configuration)
#   3. API deploy (executable deploy, migrations, service restart)
#   4. Website deploy (build, rsync to /var/www, nginx reload)
#   5. App-web deploy (build, sync, nginx reload)
#
# Pass --skip-infra to skip terraform and ansible (steps 1-2) and deploy only
# the application artifacts.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

SKIP_INFRA=false

usage() {
  cat <<EOF
Usage: $(basename "$0") [--skip-infra]

Options:
  --skip-infra  Skip terraform and ansible; deploy application artifacts only.
  -h, --help    Show this help and exit.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-infra)
      SKIP_INFRA=true
      shift
      ;;
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

DEPLOY_START="$SECONDS"
STEP_TIMINGS=()

format_duration() {
  local total="$1"
  printf '%dm%02ds' "$((total / 60))" "$((total % 60))"
}

run_step() {
  local label="$1"
  shift
  echo "--- [$label] $* ---"
  local step_start="$SECONDS"
  "$@"
  local elapsed="$((SECONDS - step_start))"
  STEP_TIMINGS+=("$(printf '%-12s %s' "$label" "$(format_duration "$elapsed")")")
  echo "[$label] done in $(format_duration "$elapsed")."
  echo ""
}

skip_step() {
  local label="$1"
  echo "--- [$label] skipped (--skip-infra) ---"
  STEP_TIMINGS+=("$(printf '%-12s %s' "$label" "skipped")")
  echo ""
}

print_timing_summary() {
  echo "--- Timing summary ---"
  local row
  for row in "${STEP_TIMINGS[@]+"${STEP_TIMINGS[@]}"}"; do
    echo "  $row"
  done
  echo "  ----------------------"
  printf '  %-12s %s\n' "total" "$(format_duration "$((SECONDS - DEPLOY_START))")"
}

echo "=== Tearleads Production Deployment ==="
echo ""

if [[ "$SKIP_INFRA" == true ]]; then
  skip_step "terraform"
else
  run_step "terraform" \
    "${REPO_ROOT}/terraform/stacks/prod/server/scripts/apply.sh" \
    --auto-approve
fi

# Resolve SSH_TARGET once (honoring a pre-set value) so sub-scripts reuse it
# shellcheck source=../terraform/scripts/common.sh
# shellcheck disable=SC1091
. "$REPO_ROOT/terraform/scripts/common.sh"
load_secrets_env prod
validate_aws_env
if [ -z "${SSH_TARGET:-}" ]; then
  STACK_DIR="$REPO_ROOT/terraform/stacks/prod/server"
  BACKEND_CONFIG="$(get_backend_config)"
  terraform -chdir="$STACK_DIR" init -backend-config="$BACKEND_CONFIG" >&2
  SSH_TARGET="$(resolve_stack_ssh_target "$STACK_DIR")"
fi
export SSH_TARGET

if [[ "$SKIP_INFRA" == true ]]; then
  skip_step "ansible"
else
  run_step "ansible" "${REPO_ROOT}/ansible/scripts/run-server-prod.sh"
fi

run_step "api" "${REPO_ROOT}/packages/api/scripts/deployProductionApi.sh"
run_step "website" "${REPO_ROOT}/packages/website/scripts/deployProductionWebsite.sh"
run_step "app-web" "${REPO_ROOT}/packages/app-web/scripts/deployProductionAppWeb.sh"

echo "=== Deployment finished ==="
echo "All steps succeeded."
echo ""
print_timing_summary
