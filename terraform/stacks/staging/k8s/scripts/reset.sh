#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env staging

NAMESPACE="${NAMESPACE:-tearleads}"
KUBECONFIG_FILE="${KUBECONFIG:-$HOME/.kube/config-staging-k8s}"
S3_BUCKET="${S3_BUCKET:-vfs-blobs}"
S3_ENDPOINT="${S3_ENDPOINT:-http://garage:3900}"
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_CLI_IMAGE="${AWS_CLI_IMAGE:-amazon/aws-cli:2}"
SECRET_NAME="${SECRET_NAME:-tearleads-secrets}"
ROLLOUT_TIMEOUT="${ROLLOUT_TIMEOUT:-300s}"
POD_WAIT_TIMEOUT="${POD_WAIT_TIMEOUT:-180s}"
LOCAL_PORT_FORWARD_PORT="${LOCAL_PORT_FORWARD_PORT:-3900}"

POSTGRES_LABEL="${POSTGRES_LABEL:-app=postgres}"

# ---------------------------------------------------------------------------
# Usage guard
# ---------------------------------------------------------------------------
if [[ "${1:-}" != "--yes" ]]; then
  echo "Usage: $0 --yes"
  echo ""
  echo "Resets the staging K8s environment (Postgres, S3, Redis)."
  echo "Pass --yes to confirm."
  exit 1
fi

# ---------------------------------------------------------------------------
# Kubeconfig check
# ---------------------------------------------------------------------------
if [[ ! -f "$KUBECONFIG_FILE" ]]; then
  echo "ERROR: Kubeconfig not found at $KUBECONFIG_FILE"
  echo "Run $SCRIPT_DIR/kubeconfig.sh first, then retry."
  exit 1
fi

export KUBECONFIG="$KUBECONFIG_FILE"

# ---------------------------------------------------------------------------
# Helpers (reused from smoke-s3.sh)
# ---------------------------------------------------------------------------
decode_base64() {
  if base64 --decode >/dev/null 2>&1 <<< "QQ=="; then
    base64 --decode
    return 0
  fi

  if base64 -d >/dev/null 2>&1 <<< "QQ=="; then
    base64 -d
    return 0
  fi

  base64 -D
}

get_secret_key_or_fail() {
  local key="$1"
  local encoded
  encoded="$(kubectl -n "$NAMESPACE" get secret "$SECRET_NAME" -o "jsonpath={.data.$key}" 2>/dev/null || true)"

  if [[ -z "$encoded" ]]; then
    echo "ERROR: Missing key $key in secret $SECRET_NAME."
    exit 1
  fi

  printf '%s' "$encoded" | decode_base64
}

script_start="$(date +%s)"

elapsed_since() {
  local start="$1"
  local secs=$(( $(date +%s) - start ))
  printf '%ds' "$secs"
}

cleanup() {
  if [[ -n "${s3_reset_pod:-}" ]]; then
    kubectl -n "$NAMESPACE" delete pod "$s3_reset_pod" --ignore-not-found >/dev/null 2>&1 || true
  fi
  if [[ -n "${port_forward_pid:-}" ]]; then
    kill "$port_forward_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 1. Scale down deployments
# ---------------------------------------------------------------------------
echo "=== Scaling down api and smtp-listener ==="
step_start="$(date +%s)"
kubectl -n "$NAMESPACE" scale deployment/api deployment/smtp-listener --replicas=0
kubectl -n "$NAMESPACE" rollout status deployment/api --timeout="$ROLLOUT_TIMEOUT"
kubectl -n "$NAMESPACE" rollout status deployment/smtp-listener --timeout="$ROLLOUT_TIMEOUT"
echo "Scale-down complete. ($(elapsed_since "$step_start"))"

# ---------------------------------------------------------------------------
# 2. Reset Redis
# ---------------------------------------------------------------------------
echo ""
echo "=== Resetting Redis ==="
step_start="$(date +%s)"
kubectl -n "$NAMESPACE" exec deploy/redis -- redis-cli FLUSHALL
echo "Redis reset complete. ($(elapsed_since "$step_start"))"

# ---------------------------------------------------------------------------
# 3. Reset S3 (Garage)
# ---------------------------------------------------------------------------
echo ""
echo "=== Resetting S3 (bucket: $S3_BUCKET) ==="
step_start="$(date +%s)"

access_key="$(get_secret_key_or_fail VFS_BLOB_S3_ACCESS_KEY_ID)"
secret_key="$(get_secret_key_or_fail VFS_BLOB_S3_SECRET_ACCESS_KEY)"

s3_reset_pod="s3-reset-$(date +%s)"
POD_WAIT_TIMEOUT_SECONDS="$(( ${POD_WAIT_TIMEOUT%s} ))"

run_s3_reset_in_cluster() {
  kubectl -n "$NAMESPACE" delete pod "$s3_reset_pod" --ignore-not-found >/dev/null 2>&1 || true

  kubectl -n "$NAMESPACE" run "$s3_reset_pod" \
    --image="$AWS_CLI_IMAGE" \
    --restart=Never \
    --env="AWS_ACCESS_KEY_ID=$access_key" \
    --env="AWS_SECRET_ACCESS_KEY=$secret_key" \
    --env="AWS_DEFAULT_REGION=$AWS_REGION" \
    --env="S3_ENDPOINT=$S3_ENDPOINT" \
    --env="S3_BUCKET=$S3_BUCKET" \
    --command -- sh -c '
set -eu
aws --endpoint-url "$S3_ENDPOINT" s3 rm "s3://$S3_BUCKET/" --recursive 2>/dev/null || true
echo "S3 bucket $S3_BUCKET emptied."
' >/dev/null

  local deadline phase reason
  deadline=$(( $(date +%s) + POD_WAIT_TIMEOUT_SECONDS ))

  while (( $(date +%s) < deadline )); do
    phase="$(kubectl -n "$NAMESPACE" get pod "$s3_reset_pod" -o jsonpath='{.status.phase}' 2>/dev/null || true)"

    if [[ "$phase" == "Succeeded" ]]; then
      kubectl -n "$NAMESPACE" logs "$s3_reset_pod"
      return 0
    fi

    if [[ "$phase" == "Failed" ]]; then
      echo "S3 reset pod failed."
      kubectl -n "$NAMESPACE" logs "$s3_reset_pod" || true
      return 1
    fi

    reason="$(kubectl -n "$NAMESPACE" get pod "$s3_reset_pod" -o jsonpath='{.status.containerStatuses[0].state.waiting.reason}' 2>/dev/null || true)"
    if [[ "$reason" == "ImagePullBackOff" || "$reason" == "ErrImagePull" ]]; then
      echo "S3 reset pod image pull failed ($reason)."
      return 2
    fi

    sleep 2
  done

  echo "S3 reset pod timed out after $POD_WAIT_TIMEOUT."
  kubectl -n "$NAMESPACE" logs "$s3_reset_pod" || true
  return 1
}

run_s3_reset_local_fallback() {
  if ! command -v aws >/dev/null 2>&1; then
    echo "ERROR: local aws CLI not found; cannot run fallback S3 reset."
    exit 1
  fi

  echo "Falling back to local aws CLI via kubectl port-forward..."

  kubectl -n "$NAMESPACE" port-forward "service/garage" "$LOCAL_PORT_FORWARD_PORT:3900" >/tmp/garage-port-forward-reset.log 2>&1 &
  port_forward_pid=$!
  sleep 2

  local local_endpoint="http://127.0.0.1:$LOCAL_PORT_FORWARD_PORT"

  AWS_ACCESS_KEY_ID="$access_key" AWS_SECRET_ACCESS_KEY="$secret_key" AWS_DEFAULT_REGION="$AWS_REGION" \
    aws --endpoint-url "$local_endpoint" s3 rm "s3://$S3_BUCKET/" --recursive 2>/dev/null || true

  echo "S3 bucket $S3_BUCKET emptied via local fallback."
}

s3_rc=0
run_s3_reset_in_cluster || s3_rc=$?

if [[ "$s3_rc" -eq 0 ]]; then
  echo "S3 reset complete. ($(elapsed_since "$step_start"))"
elif [[ "$s3_rc" -eq 2 ]]; then
  run_s3_reset_local_fallback
  echo "S3 reset complete. ($(elapsed_since "$step_start"))"
else
  echo "ERROR: S3 reset failed."
  exit 1
fi

# ---------------------------------------------------------------------------
# 4. Reset Postgres
# ---------------------------------------------------------------------------
echo ""
echo "=== Resetting Postgres ==="
step_start="$(date +%s)"

postgres_pod="$(kubectl -n "$NAMESPACE" get pods -l "$POSTGRES_LABEL" --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"

if [[ -z "$postgres_pod" ]]; then
  echo "ERROR: no running Postgres pod found (label $POSTGRES_LABEL)."
  exit 1
fi

echo "Using Postgres pod: $postgres_pod"

kubectl -n "$NAMESPACE" exec "$postgres_pod" -c postgres -- sh -c '
  PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d postgres -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '"'"'$POSTGRES_DB'"'"' AND pid <> pg_backend_pid();"
' >/dev/null 2>&1 || true

kubectl -n "$NAMESPACE" exec "$postgres_pod" -c postgres -- sh -c '
  PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d postgres -c \
    "DROP DATABASE IF EXISTS $POSTGRES_DB;"
'

kubectl -n "$NAMESPACE" exec "$postgres_pod" -c postgres -- sh -c '
  PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d postgres -c \
    "CREATE DATABASE $POSTGRES_DB OWNER $POSTGRES_USER;"
'

echo "Postgres reset complete. ($(elapsed_since "$step_start"))"

# ---------------------------------------------------------------------------
# 5. Scale up deployments
# ---------------------------------------------------------------------------
echo ""
echo "=== Scaling up api and smtp-listener ==="
step_start="$(date +%s)"
kubectl -n "$NAMESPACE" scale deployment/api deployment/smtp-listener --replicas=1

rollout_failures=0

rollout_start="$(date +%s)"
if kubectl -n "$NAMESPACE" rollout status deployment/api --timeout="$ROLLOUT_TIMEOUT"; then
  echo "  api ready ($(elapsed_since "$rollout_start"))"
else
  echo "  WARNING: api rollout did not complete ($(elapsed_since "$rollout_start"))"
  rollout_failures=$((rollout_failures + 1))
fi

rollout_start="$(date +%s)"
if kubectl -n "$NAMESPACE" rollout status deployment/smtp-listener --timeout="$ROLLOUT_TIMEOUT"; then
  echo "  smtp-listener ready ($(elapsed_since "$rollout_start"))"
else
  echo "  WARNING: smtp-listener rollout did not complete ($(elapsed_since "$rollout_start"))"
  rollout_failures=$((rollout_failures + 1))
fi

if [[ "$rollout_failures" -gt 0 ]]; then
  echo "Scale-up finished with $rollout_failures warning(s). ($(elapsed_since "$step_start"))"
else
  echo "Scale-up complete. ($(elapsed_since "$step_start"))"
fi

# ---------------------------------------------------------------------------
# 6. Run migrations
# ---------------------------------------------------------------------------
echo ""
echo "=== Running database migrations ==="
step_start="$(date +%s)"
"$SCRIPT_DIR/migrate.sh"
echo "Migrations complete. ($(elapsed_since "$step_start"))"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "========================================"
echo "  Staging reset complete ($(elapsed_since "$script_start") total)"
echo "  - Redis:    FLUSHALL"
echo "  - S3:       $S3_BUCKET emptied"
echo "  - Postgres: dropped and recreated"
echo "  - Migrations applied"
echo "========================================"
