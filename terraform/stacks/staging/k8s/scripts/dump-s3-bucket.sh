#!/bin/bash
set -euo pipefail

# Shared helper: dump an S3 bucket via Garage port-forward.
# Usage: dump-s3-bucket.sh --bucket <name> --key-id-env <VAR> --secret-env <VAR>

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env staging

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bucket) S3_BUCKET="$2"; shift 2 ;;
    --key-id-env) KEY_ID_ENV="$2"; shift 2 ;;
    --secret-env) SECRET_ENV="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

: "${S3_BUCKET:?--bucket is required}"
: "${KEY_ID_ENV:?--key-id-env is required}"
: "${SECRET_ENV:?--secret-env is required}"

NAMESPACE="${NAMESPACE:-tearleads}"
KUBECONFIG_FILE="${KUBECONFIG:-$HOME/.kube/config-staging-k8s}"
AWS_REGION="${AWS_REGION:-us-east-1}"
LOCAL_PORT_FORWARD_PORT="${LOCAL_PORT_FORWARD_PORT:-3901}"

cleanup() {
  if [[ -n "${port_forward_pid:-}" ]]; then
    kill "$port_forward_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

ACCESS_KEY_ID="${!KEY_ID_ENV:-}"
SECRET_ACCESS_KEY="${!SECRET_ENV:-}"

if [[ -z "$ACCESS_KEY_ID" || -z "$SECRET_ACCESS_KEY" ]]; then
  echo "ERROR: $KEY_ID_ENV and $SECRET_ENV must be set in .secrets/staging.env" >&2
  exit 1
fi

if [[ ! -f "$KUBECONFIG_FILE" ]]; then
  echo "ERROR: Kubeconfig not found at $KUBECONFIG_FILE" >&2
  echo "Run $SCRIPT_DIR/kubeconfig.sh first, then retry." >&2
  exit 1
fi

export KUBECONFIG="$KUBECONFIG_FILE"

if ! command -v kubectl >/dev/null 2>&1; then
  echo "ERROR: kubectl is required." >&2
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "ERROR: aws CLI is required." >&2
  exit 1
fi

echo "Port-forwarding to Garage..."
kubectl -n "$NAMESPACE" port-forward "service/garage" "$LOCAL_PORT_FORWARD_PORT:3900" >/dev/null 2>&1 &
port_forward_pid=$!

local_endpoint="http://127.0.0.1:$LOCAL_PORT_FORWARD_PORT"
echo "Waiting for port-forward to be ready..."
if ! timeout 10 bash -c "until nc -z 127.0.0.1 $LOCAL_PORT_FORWARD_PORT; do sleep 0.5; done"; then
  echo "ERROR: Port-forward to Garage failed to establish." >&2
  exit 1
fi

echo "Listing contents of $S3_BUCKET bucket:"
echo ""
AWS_ACCESS_KEY_ID="$ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$SECRET_ACCESS_KEY" \
AWS_DEFAULT_REGION="$AWS_REGION" \
  aws --endpoint-url "$local_endpoint" s3 ls "s3://$S3_BUCKET/" --recursive
