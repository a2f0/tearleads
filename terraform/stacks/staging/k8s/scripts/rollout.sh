#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env staging

KUBECONFIG_FILE="${KUBECONFIG:-$HOME/.kube/config-staging-k8s}"
ROLLOUT_TIMEOUT="${ROLLOUT_TIMEOUT:-300s}"
SKIP_WEBSITE="${SKIP_WEBSITE:-false}"
SKIP_SMOKE="${SKIP_SMOKE:-false}"
SKIP_POSTGRES_SMOKE="${SKIP_POSTGRES_SMOKE:-false}"
SKIP_SMTP_SMOKE="${SKIP_SMTP_SMOKE:-false}"

if [[ ! -f "$KUBECONFIG_FILE" ]]; then
  echo "ERROR: Kubeconfig not found at $KUBECONFIG_FILE"
  echo "Run $SCRIPT_DIR/apply02.sh first (or set KUBECONFIG)."
  exit 1
fi

export KUBECONFIG="$KUBECONFIG_FILE"

deployments=("deployment/api" "deployment/client" "deployment/smtp-listener")
if [[ "$SKIP_WEBSITE" != "true" ]]; then
  deployments+=("deployment/website")
fi

echo "Refreshing ECR pull secret..."
"$SCRIPT_DIR/setup-ecr-secret.sh"

echo "Restarting deployments..."
kubectl rollout restart "${deployments[@]}" -n tearleads

echo "Waiting for rollouts (timeout: $ROLLOUT_TIMEOUT)..."
for dep in "${deployments[@]}"; do
  kubectl rollout status "$dep" -n tearleads --timeout="$ROLLOUT_TIMEOUT"
done

echo ""
echo "Rollout complete. Deployments are running latest images."

if [[ "$SKIP_SMOKE" == "true" ]]; then
  echo "Skipping smoke tests (SKIP_SMOKE=true)."
else
  echo ""
  echo "Running API smoke test..."
  "$SCRIPT_DIR/smoke-api.sh"

  if [[ "$SKIP_POSTGRES_SMOKE" == "true" ]]; then
    echo "Skipping Postgres smoke test (SKIP_POSTGRES_SMOKE=true)."
  else
    echo ""
    echo "Running Postgres smoke test..."
    "$SCRIPT_DIR/smoke-postgres.sh"
  fi

  if [[ "$SKIP_SMTP_SMOKE" == "true" ]]; then
    echo "Skipping SMTP smoke test (SKIP_SMTP_SMOKE=true)."
  else
    echo ""
    echo "Running SMTP smoke test..."
    "$SCRIPT_DIR/smoke-smtp.sh"
  fi
fi
