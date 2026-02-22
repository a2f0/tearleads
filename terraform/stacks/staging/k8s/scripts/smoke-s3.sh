#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env

NAMESPACE="${NAMESPACE:-tearleads}"
KUBECONFIG_FILE="${KUBECONFIG:-$HOME/.kube/config-staging-k8s}"
SECRET_NAME="${SECRET_NAME:-tearleads-secrets}"
GARAGE_DEPLOYMENT="${GARAGE_DEPLOYMENT:-garage}"
GARAGE_SETUP_JOB="${GARAGE_SETUP_JOB:-garage-setup}"
S3_BUCKET="${S3_BUCKET:-vfs-blobs}"
S3_ENDPOINT="${S3_ENDPOINT:-http://garage:3900}"
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_CLI_IMAGE="${AWS_CLI_IMAGE:-amazon/aws-cli:2}"
SMOKE_PREFIX="${SMOKE_PREFIX:-smoke}"
ROLL_OUT_TIMEOUT="${ROLL_OUT_TIMEOUT:-180s}"
JOB_WAIT_TIMEOUT="${JOB_WAIT_TIMEOUT:-120s}"
POD_WAIT_TIMEOUT="${POD_WAIT_TIMEOUT:-180s}"
REQUIRE_SETUP_JOB_COMPLETE="${REQUIRE_SETUP_JOB_COMPLETE:-false}"
LOCAL_PORT_FORWARD_PORT="${LOCAL_PORT_FORWARD_PORT:-3900}"

smoke_pod="s3-smoke-$(date +%s)"
in_cluster_failure_reason=""

cleanup() {
  kubectl -n "$NAMESPACE" delete pod "$smoke_pod" --ignore-not-found >/dev/null 2>&1 || true
  if [[ -n "${port_forward_pid:-}" ]]; then
    kill "$port_forward_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

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

is_placeholder() {
  local value="$1"
  [[ "$value" =~ ^\$\{[A-Za-z_][A-Za-z0-9_]*\}$ ]]
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

require_kubeconfig_and_kubectl() {
  if [[ ! -f "$KUBECONFIG_FILE" ]]; then
    echo "ERROR: Kubeconfig not found at $KUBECONFIG_FILE"
    echo "Run $SCRIPT_DIR/kubeconfig.sh first, then retry."
    exit 1
  fi

  export KUBECONFIG="$KUBECONFIG_FILE"

  if ! command -v kubectl >/dev/null 2>&1; then
    echo "ERROR: kubectl is required."
    exit 1
  fi
}

check_setup_job_non_blocking() {
  if ! kubectl -n "$NAMESPACE" get "job/$GARAGE_SETUP_JOB" >/dev/null 2>&1; then
    echo "Garage setup job not found (likely GC'd by ttlSecondsAfterFinished); continuing."
    return
  fi

  echo "Checking Garage setup job completion..."
  if kubectl -n "$NAMESPACE" wait --for=condition=complete "job/$GARAGE_SETUP_JOB" --timeout="$JOB_WAIT_TIMEOUT" >/dev/null 2>&1; then
    echo "Garage setup job completed."
    return
  fi

  local summary
  summary="$(kubectl -n "$NAMESPACE" get "job/$GARAGE_SETUP_JOB" -o jsonpath='{.status.succeeded}/{.spec.completions} succeeded, failed={.status.failed}, active={.status.active}' 2>/dev/null || echo 'status unavailable')"

  if [[ "$REQUIRE_SETUP_JOB_COMPLETE" == "true" ]]; then
    echo "ERROR: Garage setup job did not complete within $JOB_WAIT_TIMEOUT ($summary)."
    exit 1
  fi

  echo "Garage setup job not complete within $JOB_WAIT_TIMEOUT ($summary); continuing."
}

check_placeholder_secrets_or_fail() {
  local garage_rpc_secret garage_admin_token
  garage_rpc_secret="$(get_secret_key_or_fail GARAGE_RPC_SECRET)"
  garage_admin_token="$(get_secret_key_or_fail GARAGE_ADMIN_TOKEN)"
  access_key="$(get_secret_key_or_fail VFS_BLOB_S3_ACCESS_KEY_ID)"
  secret_key="$(get_secret_key_or_fail VFS_BLOB_S3_SECRET_ACCESS_KEY)"

  if is_placeholder "$garage_rpc_secret" || is_placeholder "$garage_admin_token" || is_placeholder "$access_key" || is_placeholder "$secret_key"; then
    echo "ERROR: $SECRET_NAME contains placeholder values (for example \${...})."
    echo "Apply rendered secrets first, for example:"
    echo "  source .secrets/env"
    echo "  envsubst < terraform/stacks/staging/k8s/manifests/secrets.yaml | kubectl apply -f -"
    exit 1
  fi
}

run_in_cluster_smoke() {
  kubectl -n "$NAMESPACE" delete pod "$smoke_pod" --ignore-not-found >/dev/null 2>&1 || true

  kubectl -n "$NAMESPACE" run "$smoke_pod" \
    --image="$AWS_CLI_IMAGE" \
    --restart=Never \
    --env="AWS_ACCESS_KEY_ID=$access_key" \
    --env="AWS_SECRET_ACCESS_KEY=$secret_key" \
    --env="AWS_DEFAULT_REGION=$AWS_REGION" \
    --env="S3_ENDPOINT=$S3_ENDPOINT" \
    --env="S3_BUCKET=$S3_BUCKET" \
    --env="SMOKE_PREFIX=$SMOKE_PREFIX" \
    --command -- sh -lc '
set -euo pipefail
key="$SMOKE_PREFIX/$(date +%s)-$RANDOM.txt"
payload="s3-smoke-$(date -u +%FT%TZ)"
printf "%s" "$payload" > /tmp/payload.txt
aws --endpoint-url "$S3_ENDPOINT" s3api put-object --bucket "$S3_BUCKET" --key "$key" --body /tmp/payload.txt >/dev/null
aws --endpoint-url "$S3_ENDPOINT" s3api get-object --bucket "$S3_BUCKET" --key "$key" /tmp/out.txt >/dev/null
read_back="$(cat /tmp/out.txt)"
if [[ "$read_back" != "$payload" ]]; then
  echo "ERROR: read payload did not match write payload"
  echo "expected=$payload"
  echo "actual=$read_back"
  exit 1
fi
aws --endpoint-url "$S3_ENDPOINT" s3api delete-object --bucket "$S3_BUCKET" --key "$key" >/dev/null
echo "S3 smoke test passed (bucket=$S3_BUCKET key=$key endpoint=$S3_ENDPOINT)"
' >/dev/null

  local deadline phase reason
  deadline=$(( $(date +%s) + POD_WAIT_TIMEOUT_SECONDS ))

  while (( $(date +%s) < deadline )); do
    phase="$(kubectl -n "$NAMESPACE" get pod "$smoke_pod" -o jsonpath='{.status.phase}' 2>/dev/null || true)"

    if [[ "$phase" == "Succeeded" ]]; then
      kubectl -n "$NAMESPACE" logs "$smoke_pod"
      return 0
    fi

    if [[ "$phase" == "Failed" ]]; then
      echo "In-cluster smoke pod failed."
      kubectl -n "$NAMESPACE" logs "$smoke_pod" || true
      return 1
    fi

    reason="$(kubectl -n "$NAMESPACE" get pod "$smoke_pod" -o jsonpath='{.status.containerStatuses[0].state.waiting.reason}' 2>/dev/null || true)"
    if [[ "$reason" == "ImagePullBackOff" || "$reason" == "ErrImagePull" ]]; then
      in_cluster_failure_reason="$reason"
      echo "In-cluster smoke pod image pull failed ($reason)."
      return 2
    fi

    sleep 2
  done

  echo "In-cluster smoke pod timed out after $POD_WAIT_TIMEOUT."
  kubectl -n "$NAMESPACE" logs "$smoke_pod" || true
  return 1
}

run_local_fallback_smoke() {
  if ! command -v aws >/dev/null 2>&1; then
    echo "ERROR: local aws CLI not found; cannot run fallback smoke test."
    exit 1
  fi

  echo "Falling back to local aws CLI via kubectl port-forward..."

  kubectl -n "$NAMESPACE" port-forward "service/garage" "$LOCAL_PORT_FORWARD_PORT:3900" >/tmp/garage-port-forward.log 2>&1 &
  port_forward_pid=$!
  sleep 2

  local local_endpoint key payload out
  local_endpoint="http://127.0.0.1:$LOCAL_PORT_FORWARD_PORT"
  key="$SMOKE_PREFIX/local-$(date +%s)-$RANDOM.txt"
  payload="s3-smoke-local-$(date -u +%FT%TZ)"

  printf '%s' "$payload" > /tmp/s3-smoke-in.txt

  AWS_ACCESS_KEY_ID="$access_key" AWS_SECRET_ACCESS_KEY="$secret_key" AWS_DEFAULT_REGION="$AWS_REGION" \
    aws --endpoint-url "$local_endpoint" s3api put-object --bucket "$S3_BUCKET" --key "$key" --body /tmp/s3-smoke-in.txt >/dev/null

  AWS_ACCESS_KEY_ID="$access_key" AWS_SECRET_ACCESS_KEY="$secret_key" AWS_DEFAULT_REGION="$AWS_REGION" \
    aws --endpoint-url "$local_endpoint" s3api get-object --bucket "$S3_BUCKET" --key "$key" /tmp/s3-smoke-out.txt >/dev/null

  out="$(cat /tmp/s3-smoke-out.txt)"
  if [[ "$out" != "$payload" ]]; then
    echo "ERROR: local fallback payload mismatch."
    echo "expected=$payload"
    echo "actual=$out"
    exit 1
  fi

  AWS_ACCESS_KEY_ID="$access_key" AWS_SECRET_ACCESS_KEY="$secret_key" AWS_DEFAULT_REGION="$AWS_REGION" \
    aws --endpoint-url "$local_endpoint" s3api delete-object --bucket "$S3_BUCKET" --key "$key" >/dev/null

  echo "S3 smoke test passed via local fallback (bucket=$S3_BUCKET key=$key endpoint=$local_endpoint)"
}

require_kubeconfig_and_kubectl

POD_WAIT_TIMEOUT_SECONDS="$(( ${POD_WAIT_TIMEOUT%s} ))"
if [[ "$POD_WAIT_TIMEOUT_SECONDS" -le 0 ]]; then
  echo "ERROR: POD_WAIT_TIMEOUT must be a positive duration in seconds (e.g. 180s)."
  exit 1
fi

echo "Using kubeconfig: $KUBECONFIG"
echo "Namespace: $NAMESPACE"
echo ""

if ! kubectl -n "$NAMESPACE" get "deployment/$GARAGE_DEPLOYMENT" >/dev/null 2>&1; then
  echo "ERROR: deployment/$GARAGE_DEPLOYMENT not found in namespace $NAMESPACE."
  echo "Deploy it first with:"
  echo "  $SCRIPT_DIR/deploy.sh"
  echo "Or apply only Garage with:"
  echo "  kubectl apply -f \"$SCRIPT_DIR/../manifests/garage.yaml\""
  exit 1
fi

echo "Checking Garage rollout..."
kubectl -n "$NAMESPACE" rollout status "deployment/$GARAGE_DEPLOYMENT" --timeout="$ROLL_OUT_TIMEOUT"

check_setup_job_non_blocking
check_placeholder_secrets_or_fail

echo "Running in-cluster S3 put/get/delete smoke test..."
if run_in_cluster_smoke; then
  echo ""
  echo "All checks passed."
  exit 0
fi

if [[ "$in_cluster_failure_reason" == "ImagePullBackOff" || "$in_cluster_failure_reason" == "ErrImagePull" ]]; then
  run_local_fallback_smoke
  echo ""
  echo "All checks passed."
  exit 0
fi

echo "ERROR: S3 smoke test failed."
exit 1
