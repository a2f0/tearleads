#!/usr/bin/env bash
# Full production deployment for Tearleads
#
# Runs in order:
#   1. Prepare the environment's independent S3 storage
#   2. terraform apply (production server stack)
#   3. ansible playbook (server configuration)
#   4. API deploy (embedded source maps, migrations, service restart)
#   5. Website deploy (build, Wrangler, independent domain Terraform)
#   6. App-web deploy (build, upload Sentry maps, sync, nginx reload)
#
# Pass --skip-terraform when a caller already prepared storage and applied the
# server stack, or --skip-infra to deploy only the application artifacts.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

SKIP_INFRA=false
SKIP_TERRAFORM=false

usage() {
  cat <<EOF
Usage: $(basename "$0") [--skip-terraform] [--skip-infra]

Options:
  --skip-terraform  Skip server/storage Terraform; website domains still reconcile.
  --skip-infra  Skip all Terraform and Ansible; publish application artifacts only.
  -h, --help    Show this help and exit.

Environment:
  PRODUCTION_SSH_TARGET  Optional explicit production SSH target.

Configured Sentry source maps are handled by the API and app-web deploy steps.
Web map upload failures stop publication; API maps stay in the executable.

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

# shellcheck source=stepTimings.sh
# shellcheck disable=SC1091
. "$REPO_ROOT/scripts/stepTimings.sh"
step_timings_reset

echo "=== Tearleads Production Deployment ==="
echo ""

if [[ "$SKIP_TERRAFORM" == true ]]; then
  if [[ "$SKIP_INFRA" == true ]]; then
    step_timings_skip "terraform" --skip-infra
  else
    step_timings_skip "terraform" --skip-terraform
  fi
else
  step_timings_run "storage" "${REPO_ROOT}/terraform/scripts/prepare-storage.sh" prod
  step_timings_run "terraform" \
    "${REPO_ROOT}/terraform/stacks/prod/server/scripts/apply.sh" \
    --auto-approve
fi

# Resolve SSH_TARGET once so sub-scripts reuse it.
load_secrets_env prod
validate_aws_env
validate_stripe_env prod
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
  step_timings_skip "ansible" --skip-infra
else
  step_timings_run "ansible" "${REPO_ROOT}/ansible/scripts/run-server-prod.sh"
fi

step_timings_run "api" "${REPO_ROOT}/packages/api/scripts/deployProductionApi.sh"
if [[ "$SKIP_INFRA" == true ]]; then
  step_timings_run "website" "${REPO_ROOT}/packages/website/scripts/deployProductionWebsite.sh" --skip-terraform
else
  step_timings_run "website" "${REPO_ROOT}/packages/website/scripts/deployProductionWebsite.sh"
fi
step_timings_run "app-web" "${REPO_ROOT}/packages/app-web/scripts/deployProductionAppWeb.sh"

echo "=== Deployment finished ==="
echo "All steps succeeded."
echo ""
step_timings_summary
