#!/usr/bin/env bash
# Full staging deployment for Tearleads
#
# Runs in order:
#   1. Prepare the environment's independent S3 storage
#   2. Terraform apply (independent PlanetScale Postgres stack)
#   3. API deploy (migrations, Worker secrets, Worker publish)
#   4. Terraform apply (edge stack: API, app, and demo hostnames)
#   5. API verification over the public hostname
#   6. Website deploy (build, Wrangler, independent domain Terraform)
#   7. App-web deploy (build, upload Sentry maps, Workers Static Assets)
#
# Pass --skip-terraform when a caller already prepared storage, the database,
# and the edge hostnames; --skip-infra is its alias now that no server exists.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

SKIP_TERRAFORM=false

usage() {
  cat <<USAGE
Usage: $(basename "$0") [--skip-terraform] [--skip-infra]

Options:
  --skip-terraform  Skip storage, database, and edge Terraform; website domains still reconcile.
  --skip-infra      Alias of --skip-terraform.
  -h, --help        Show this help and exit.

Configured Sentry source maps are handled by the API and app-web deploy steps.
Web map upload failures stop publication; API maps upload with the Worker.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-terraform | --skip-infra)
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

# shellcheck source=scripts/lib/stepTimings.sh
# shellcheck disable=SC1091
. "$REPO_ROOT/scripts/lib/stepTimings.sh"
step_timings_reset

echo "=== Tearleads Staging Deployment ==="
echo ""

if [[ "$SKIP_TERRAFORM" == true ]]; then
  step_timings_skip "storage" --skip-terraform
  step_timings_skip "postgres" --skip-terraform
else
  step_timings_run "storage" "${REPO_ROOT}/terraform/scripts/prepare-storage.sh" staging
  step_timings_run "postgres" "${REPO_ROOT}/terraform/scripts/prepare-postgres.sh" staging
fi

step_timings_run "api" "${REPO_ROOT}/packages/api/scripts/deployApi.sh" staging
if [[ "$SKIP_TERRAFORM" == true ]]; then
  step_timings_skip "edge" --skip-terraform
else
  step_timings_run "edge" "${REPO_ROOT}/terraform/scripts/run-edge-stack.sh" staging apply -auto-approve
fi
step_timings_run "api-verify" "${REPO_ROOT}/packages/api/scripts/verifyApi.sh" staging
if [[ "$SKIP_TERRAFORM" == true ]]; then
  step_timings_run "website" "${REPO_ROOT}/scripts/deployStagingWebsite.sh" --skip-terraform
else
  step_timings_run "website" "${REPO_ROOT}/scripts/deployStagingWebsite.sh"
fi
step_timings_run "app-web" "${REPO_ROOT}/packages/app-web/scripts/deployStagingAppWeb.sh"

echo "=== Deployment finished ==="
echo "All steps succeeded."
echo ""
step_timings_summary
