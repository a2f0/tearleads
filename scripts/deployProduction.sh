#!/usr/bin/env bash
# Full production deployment for Tearleads
#
# Runs in order:
#   1. terraform apply (production server stack)
#   2. ansible playbook (server configuration)
#   3. API deploy (executable deploy, migrations, service restart)
#   4. Website deploy (build, rsync to /var/www, nginx reload)
#   5. App-web deploy (build app + demo bundles, sync, nginx reload)
#
# Pass --skip-terraform when a caller already applied the stack, or --skip-infra
# to skip both terraform and ansible and deploy only the application artifacts.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

SKIP_INFRA=false
SKIP_TERRAFORM=false

usage() {
  cat <<EOF
Usage: $(basename "$0") [--skip-terraform] [--skip-infra]

Options:
  --skip-terraform  Skip terraform but still configure the server with Ansible.
  --skip-infra  Skip terraform and ansible; deploy application artifacts only.
  -h, --help    Show this help and exit.

Environment:
  PRODUCTION_SSH_TARGET  Optional explicit production SSH target.

SSH_TARGET is unsupported; use PRODUCTION_SSH_TARGET so the deployment tier is
explicit.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-terraform)
      SKIP_TERRAFORM=true
      shift
      ;;
    --skip-infra)
      SKIP_INFRA=true
      SKIP_TERRAFORM=true
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

# Reject an ambiguous generic target before Terraform changes infrastructure.
# shellcheck source=../terraform/scripts/common.sh
# shellcheck disable=SC1091
. "$REPO_ROOT/terraform/scripts/common.sh"
validate_tier_ssh_target_override prod

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

if [[ "$SKIP_TERRAFORM" == true ]]; then
  if [[ "$SKIP_INFRA" == true ]]; then
    skip_step "terraform"
  else
    echo "--- [terraform] skipped (--skip-terraform) ---"
    STEP_TIMINGS+=("$(printf '%-12s %s' "terraform" "skipped")")
    echo ""
  fi
else
  run_step "terraform" \
    "${REPO_ROOT}/terraform/stacks/prod/server/scripts/apply.sh" \
    --auto-approve
fi

# Resolve SSH_TARGET once so sub-scripts reuse it.
load_secrets_env prod
validate_aws_env
if [ -z "${SSH_TARGET:-}" ]; then
  STACK_DIR="$REPO_ROOT/terraform/stacks/prod/server"
  BACKEND_CONFIG="$(get_backend_config)"
  terraform -chdir="$STACK_DIR" init -backend-config="$BACKEND_CONFIG" >&2
  SSH_TARGET="$(resolve_stack_ssh_target "$STACK_DIR")"
fi
export SSH_TARGET
PRODUCTION_SSH_TARGET="$SSH_TARGET"
export PRODUCTION_SSH_TARGET

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
