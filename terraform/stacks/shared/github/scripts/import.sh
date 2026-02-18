#!/bin/bash
# Import existing GitHub resources into Terraform state
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"

echo "Importing existing GitHub resources..."
echo ""

# Import repository
echo "Importing repository..."
terraform -chdir="$STACK_DIR" import github_repository.main tearleads || true

# Import branch protection
echo "Importing branch protection for main..."
terraform -chdir="$STACK_DIR" import 'github_branch_protection.main[0]' tearleads:main || true

if [ -n "${MERGE_SIGNING_APP_INSTALLATION_ID:-}" ]; then
  echo "Importing merge-signing app installation repository link..."
  terraform -chdir="$STACK_DIR" import \
    'github_app_installation_repository.merge_signing[0]' \
    "${MERGE_SIGNING_APP_INSTALLATION_ID}:tearleads" || true
fi

echo ""
echo "Import complete. Run ./scripts/plan.sh to see any drift."
