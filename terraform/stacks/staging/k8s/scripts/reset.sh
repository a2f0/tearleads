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
AWS_CLI_IMAGE="${AWS_CLI_IMAGE:-amazon/aws-cli:latest}"
S3_RESET_MODE="${S3_RESET_MODE:-auto}"
SECRET_NAME="${SECRET_NAME:-tearleads-secrets}"
ROLLOUT_TIMEOUT="${ROLLOUT_TIMEOUT:-300s}"
POD_WAIT_TIMEOUT="${POD_WAIT_TIMEOUT:-180s}"
LOCAL_PORT_FORWARD_PORT="${LOCAL_PORT_FORWARD_PORT:-3900}"

POSTGRES_LABEL="${POSTGRES_LABEL:-app=postgres}"

# shellcheck source=./s3-helpers.sh
source "$SCRIPT_DIR/s3-helpers.sh"

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

script_start="$(date +%s)"

elapsed_since() {
  local start="$1"
  local secs=$(( $(date +%s) - start ))
  printf '%ds' "$secs"
}

resolve_s3_reset_mode() {
  case "$S3_RESET_MODE" in
    auto)
      if command -v aws >/dev/null 2>&1; then
        printf 'local'
      else
        printf 'in-cluster'
      fi
      ;;
    local|in-cluster)
      printf '%s' "$S3_RESET_MODE"
      ;;
    *)
      echo "ERROR: S3_RESET_MODE must be one of: auto, local, in-cluster."
      exit 1
      ;;
  esac
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
echo "=== Scaling down api, api-v2, and smtp-listener ==="
step_start="$(date +%s)"
kubectl -n "$NAMESPACE" scale deployment/api deployment/api-v2 deployment/smtp-listener --replicas=0
kubectl -n "$NAMESPACE" rollout status deployment/api --timeout="$ROLLOUT_TIMEOUT"
kubectl -n "$NAMESPACE" rollout status deployment/api-v2 --timeout="$ROLLOUT_TIMEOUT"
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
assert_s3_secret_sync_with_env "Re-apply rendered secrets before reset:"

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
aws --endpoint-url "$S3_ENDPOINT" s3 rm "s3://$S3_BUCKET/" --recursive
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

run_s3_reset_local() {
  if ! command -v aws >/dev/null 2>&1; then
    echo "ERROR: local aws CLI not found; cannot run local S3 reset."
    return 1
  fi

  echo "Running local aws CLI S3 reset via kubectl port-forward..."

  kubectl -n "$NAMESPACE" port-forward "service/garage" "$LOCAL_PORT_FORWARD_PORT:3900" >/tmp/garage-port-forward-reset.log 2>&1 &
  port_forward_pid=$!
  sleep 2

  if ! kill -0 "$port_forward_pid" 2>/dev/null; then
    echo "ERROR: failed to start Garage port-forward for local S3 reset."
    return 1
  fi

  local local_endpoint="http://127.0.0.1:$LOCAL_PORT_FORWARD_PORT"

  local rm_output=""
  if ! rm_output="$(
    AWS_ACCESS_KEY_ID="$access_key" AWS_SECRET_ACCESS_KEY="$secret_key" AWS_DEFAULT_REGION="$AWS_REGION" \
      aws --endpoint-url "$local_endpoint" s3 rm "s3://$S3_BUCKET/" --recursive 2>&1
  )"; then
    echo "$rm_output"
    if grep -qi "No such key" <<< "$rm_output"; then
      print_missing_garage_key_hint
    fi
    return 1
  fi

  echo "S3 bucket $S3_BUCKET emptied via local aws CLI."

  kill "$port_forward_pid" >/dev/null 2>&1 || true
  wait "$port_forward_pid" >/dev/null 2>&1 || true
  unset port_forward_pid
  return 0
}

effective_s3_reset_mode="$(resolve_s3_reset_mode)"

if [[ "$effective_s3_reset_mode" == "local" ]]; then
  if [[ "$S3_RESET_MODE" == "auto" ]]; then
    echo "Using local S3 reset mode (aws CLI detected)."
  fi
  run_s3_reset_local || {
    echo "ERROR: S3 reset failed in local mode."
    exit 1
  }
else
  if [[ "$S3_RESET_MODE" == "auto" ]]; then
    echo "Using in-cluster S3 reset mode (local aws CLI not detected)."
  fi
  run_s3_reset_in_cluster || {
    echo "ERROR: S3 reset failed in in-cluster mode."
    exit 1
  }
fi

echo "S3 reset complete. ($(elapsed_since "$step_start"))"

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
echo "=== Scaling up api, api-v2, and smtp-listener ==="
step_start="$(date +%s)"
kubectl -n "$NAMESPACE" scale deployment/api deployment/api-v2 deployment/smtp-listener --replicas=1

rollout_failures=0

rollout_start="$(date +%s)"
if kubectl -n "$NAMESPACE" rollout status deployment/api --timeout="$ROLLOUT_TIMEOUT"; then
  echo "  api ready ($(elapsed_since "$rollout_start"))"
else
  echo "  WARNING: api rollout did not complete ($(elapsed_since "$rollout_start"))"
  rollout_failures=$((rollout_failures + 1))
fi

rollout_start="$(date +%s)"
if kubectl -n "$NAMESPACE" rollout status deployment/api-v2 --timeout="$ROLLOUT_TIMEOUT"; then
  echo "  api-v2 ready ($(elapsed_since "$rollout_start"))"
else
  echo "  WARNING: api-v2 rollout did not complete ($(elapsed_since "$rollout_start"))"
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
