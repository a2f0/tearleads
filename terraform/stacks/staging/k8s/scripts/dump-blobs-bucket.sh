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
AWS_REGION="${AWS_REGION:-us-east-1}"
LOCAL_PORT_FORWARD_PORT="${LOCAL_PORT_FORWARD_PORT:-3901}"

cleanup() {
  if [[ -n "${port_forward_pid:-}" ]]; then
    kill "$port_forward_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ -z "${VFS_BLOB_S3_ACCESS_KEY_ID:-}" || -z "${VFS_BLOB_S3_SECRET_ACCESS_KEY:-}" ]]; then
  echo "ERROR: VFS_BLOB_S3_ACCESS_KEY_ID and VFS_BLOB_S3_SECRET_ACCESS_KEY must be set in .secrets/staging.env" >&2
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
sleep 2

local_endpoint="http://127.0.0.1:$LOCAL_PORT_FORWARD_PORT"

echo "Listing contents of $S3_BUCKET bucket:"
echo ""
AWS_ACCESS_KEY_ID="$VFS_BLOB_S3_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$VFS_BLOB_S3_SECRET_ACCESS_KEY" \
AWS_DEFAULT_REGION="$AWS_REGION" \
  aws --endpoint-url "$local_endpoint" s3 ls "s3://$S3_BUCKET/" --recursive
