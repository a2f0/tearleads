#!/bin/bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

format_duration() {
  local total_seconds=$1
  local minutes=$((total_seconds / 60))
  local seconds=$((total_seconds % 60))
  if [ "$minutes" -gt 0 ]; then
    printf "%dm %ds" "$minutes" "$seconds"
  else
    printf "%ds" "$seconds"
  fi
}

NAMESPACE="${NAMESPACE:-tearleads}"
KUBECONFIG_FILE="${KUBECONFIG:-$HOME/.kube/config-staging-k8s}"
LOCAL_PG_PORT="${LOCAL_PG_PORT:-15432}"
SECRET_NAME="${SECRET_NAME:-tearleads-secrets}"

# ---------------------------------------------------------------------------
# Usage guard
# ---------------------------------------------------------------------------
if [[ "${1:-}" != "--yes" ]]; then
  echo "Usage: $0 --yes"
  echo ""
  echo "Resets the staging K8s environment and scaffolds test data."
  echo ""
  echo "Steps:"
  echo "  1. Run staging K8s reset (Postgres, S3, Redis, migrations)"
  echo "  2. Port-forward to staging Postgres"
  echo "  3. Scaffold Bob/Alice notes, welcome emails, and shared photos"
  echo ""
  echo "Pass --yes to confirm."
  exit 1
fi

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
cleanup() {
  if [[ -n "${port_forward_pid:-}" ]]; then
    kill "$port_forward_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 1. Run staging K8s reset
# ---------------------------------------------------------------------------
TOTAL_START=$SECONDS
STEP_START=$SECONDS
echo "=== Step 1/2: Resetting staging K8s environment ==="
"$REPO_ROOT/terraform/stacks/staging/k8s/scripts/reset.sh" --yes
echo "  Step 1/2 completed in $(format_duration $((SECONDS - STEP_START)))"

# ---------------------------------------------------------------------------
# 2. Scaffold test data via port-forward
# ---------------------------------------------------------------------------
echo ""
STEP_START=$SECONDS
echo "=== Step 2/2: Scaffolding test data ==="

export KUBECONFIG="$KUBECONFIG_FILE"

# Read DB credentials from the k8s configmap and secret (source of truth).
PG_USER="$(kubectl -n "$NAMESPACE" get configmap tearleads-config -o jsonpath='{.data.POSTGRES_USER}')"
PG_DB="$(kubectl -n "$NAMESPACE" get configmap tearleads-config -o jsonpath='{.data.POSTGRES_DATABASE}')"
PG_PASS="$(kubectl -n "$NAMESPACE" get secret "$SECRET_NAME" -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 --decode)"

echo "Port-forwarding staging Postgres to localhost:$LOCAL_PG_PORT..."
kubectl -n "$NAMESPACE" port-forward "service/postgres" "$LOCAL_PG_PORT:5432" >/dev/null 2>&1 &
port_forward_pid=$!
sleep 2

if ! kill -0 "$port_forward_pid" 2>/dev/null; then
  echo "ERROR: Port-forward failed to start."
  exit 1
fi

export DATABASE_URL="postgresql://$PG_USER:$PG_PASS@127.0.0.1:$LOCAL_PG_PORT/$PG_DB"

echo "Running createBobAndAlice (notes, emails, shared photo album)..."
"$REPO_ROOT/scripts/users/scaffolding/createBobAndAlice.ts"
echo "  createBobAndAlice completed (all scaffold steps ran)."
echo "  Step 2/2 completed in $(format_duration $((SECONDS - STEP_START)))"

echo ""
echo "========================================"
echo "  Staging reset + scaffold complete in $(format_duration $((SECONDS - TOTAL_START)))"
echo "========================================"
