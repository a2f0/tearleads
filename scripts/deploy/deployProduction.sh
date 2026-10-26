#!/usr/bin/env bash
# Full prod deployment for Tearleads
#
# Runs in order:
#   1. Prepare the environment's independent R2 storage
#   2. Terraform apply (independent PlanetScale Postgres stack)
#   3. API deploy (migrations, Worker secrets, Worker publish)
#   4. App-web deploy (build, upload Sentry maps, Workers Static Assets)
#   5. Terraform apply (edge stack: API, app, and demo hostnames)
#   6. API verification over the public hostname
#   7. Website deploy (build, Wrangler, independent domain Terraform)
#
# The edge stack attaches hostnames to Workers that must already exist, so the
# API and app Workers publish before it runs.
#
# Pass --skip-terraform when a caller already prepared storage, the database,
# the edge hostnames, and the website domains; --skip-infra is its alias now
# that no server exists.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

SKIP_TERRAFORM=false

usage() {
  cat <<USAGE
Usage: $(basename "$0") [--skip-terraform] [--skip-infra]

Options:
  --skip-terraform  Skip every Terraform apply (storage, database, edge, and website domains); Workers and assets still deploy.
  --skip-infra      Alias of --skip-terraform.
  -h, --help        Show this help and exit.

Configured Sentry source maps are handled by the API and app-web deploy steps.
Map upload failures stop publication for both the API and web app.
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

echo "=== Tearleads Production Deployment ==="
echo ""

if [[ "$SKIP_TERRAFORM" == true ]]; then
  step_timings_skip "storage" --skip-terraform
  step_timings_skip "postgres" --skip-terraform
else
  step_timings_run "storage" "${REPO_ROOT}/terraform/scripts/prepare-storage.sh" prod
  step_timings_run "postgres" "${REPO_ROOT}/terraform/scripts/prepare-postgres.sh" prod
fi

step_timings_run "api" "${REPO_ROOT}/packages/api/scripts/deployApi.sh" prod
step_timings_run "app-web" "${REPO_ROOT}/packages/app-web/scripts/deployProductionAppWeb.sh"
if [[ "$SKIP_TERRAFORM" == true ]]; then
  step_timings_skip "edge" --skip-terraform
else
  step_timings_run "edge" "${REPO_ROOT}/terraform/scripts/run-edge-stack.sh" prod apply -auto-approve
fi
step_timings_run "api-verify" "${REPO_ROOT}/packages/api/scripts/verifyApi.sh" prod
if [[ "$SKIP_TERRAFORM" == true ]]; then
  step_timings_run "website" "${REPO_ROOT}/scripts/deploy/deployProductionWebsite.sh" --skip-terraform
else
  step_timings_run "website" "${REPO_ROOT}/scripts/deploy/deployProductionWebsite.sh"
fi

echo "=== Deployment finished ==="
echo "All steps succeeded."
echo ""
step_timings_summary
