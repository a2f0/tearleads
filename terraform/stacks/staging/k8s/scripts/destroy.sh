#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env staging
setup_ssh_host_keys

echo "WARNING: This will destroy the staging k8s cluster."
echo "All workloads and data on this cluster will be lost."
echo "Press Ctrl+C to cancel, or wait 5 seconds to continue..."
sleep 5

terraform -chdir="$STACK_DIR" destroy "$@"

echo "Removing STAGING_KUBECONFIG_B64 from GitHub Actions secrets..."
REPO="$(get_github_repo)"
if gh secret delete STAGING_KUBECONFIG_B64 -R "$REPO" 2>/dev/null; then
  echo "STAGING_KUBECONFIG_B64 secret removed."
else
  echo "STAGING_KUBECONFIG_B64 secret was not set (nothing to remove)."
fi

echo "Removing STAGING_K8S_SSH_HOST from GitHub Actions variables..."
if gh variable delete STAGING_K8S_SSH_HOST -R "$REPO" 2>/dev/null; then
  echo "STAGING_K8S_SSH_HOST variable removed."
else
  echo "STAGING_K8S_SSH_HOST variable was not set (nothing to remove)."
fi
