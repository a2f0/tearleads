#!/usr/bin/env bash
# Full staging deployment for Tearleads
#
# Runs in order:
#   1. terraform apply (staging server stack)
#   2. ansible playbook (server configuration)
#   3. API deploy (source sync, deps, migrations, service restart)
#   4. Website deploy (build, rsync to /var/www, nginx reload)
#   5. App-web deploy (build, source sync, deps, service restart)

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

STEPS=(
  "terraform:${REPO_ROOT}/terraform/stacks/staging/server/scripts/apply.sh"
  "ansible:${REPO_ROOT}/ansible/scripts/run-server-staging.sh"
  "api:${REPO_ROOT}/packages/api/scripts/deployStagingApi.sh"
  "website:${REPO_ROOT}/packages/website/scripts/deployStagingWebsite.sh"
  "app-web:${REPO_ROOT}/packages/app-web/scripts/deployStagingAppWeb.sh"
)

FAILED=()

echo "=== Tearleads Staging Deployment ==="
echo ""

for step in "${STEPS[@]}"; do
  label="${step%%:*}"
  script="${step#*:}"

  echo "--- [$label] $script ---"
  if ! bash "$script"; then
    echo "ERROR: [$label] failed."
    FAILED+=("$label")
  else
    echo "[$label] done."
  fi
  echo ""
done

echo "=== Deployment finished ==="
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "Failed steps: ${FAILED[*]}"
  exit 1
fi
echo "All steps succeeded."
