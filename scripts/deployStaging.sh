#!/usr/bin/env bash
# Full staging deployment for Tearleads
#
# Runs in order:
#   1. terraform apply (staging server stack)
#   2. ansible playbook (server configuration)
#   3. API deploy (executable deploy, migrations, service restart)
#   4. Website deploy (build, rsync to /var/www, nginx reload)
#   5. App-web deploy (build, source sync, deps, service restart)

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

run_step() {
  local label="$1"
  shift
  echo "--- [$label] $* ---"
  "$@"
  echo "[$label] done."
  echo ""
}

echo "=== Tearleads Staging Deployment ==="
echo ""

run_step "terraform" \
  "${REPO_ROOT}/terraform/stacks/staging/server/scripts/apply.sh" \
  --auto-approve
run_step "ansible" "${REPO_ROOT}/ansible/scripts/run-server-staging.sh"
run_step "api" "${REPO_ROOT}/packages/api/scripts/deployStagingApi.sh"
run_step "website" "${REPO_ROOT}/packages/website/scripts/deployStagingWebsite.sh"
run_step "app-web" "${REPO_ROOT}/packages/app-web/scripts/deployStagingAppWeb.sh"

echo "=== Deployment finished ==="
echo "All steps succeeded."
