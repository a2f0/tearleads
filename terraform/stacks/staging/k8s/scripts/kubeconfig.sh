#!/bin/bash
set -euo pipefail

# Fetches kubeconfig from the staging k3s server, rewrites the API host, and
# optionally runs a command with KUBECONFIG set (so no shell export is needed).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env

# Ensure Terraform backend/providers are initialized before reading outputs.
"$SCRIPT_DIR/init.sh" >/dev/null

# Get outputs from Terraform (use DNS hostname for SSH to match known_hosts entries)
SSH_HOSTNAME=$(terraform -chdir="$STACK_DIR" output -raw ssh_hostname)
if K8S_API_HOSTNAME=$(terraform -chdir="$STACK_DIR" output -raw k8s_api_hostname 2>/dev/null); then
  :
else
  K8S_API_HOSTNAME=$(terraform -chdir="$STACK_DIR" output -raw k8s_hostname)
fi

if SERVER_USERNAME=$(terraform -chdir="$STACK_DIR" output -raw server_username 2>/dev/null); then
  :
elif SERVER_USERNAME=$(terraform -chdir="$STACK_DIR" output -raw SERVER_USERNAME 2>/dev/null); then
  :
else
  SSH_COMMAND=$(terraform -chdir="$STACK_DIR" output -raw ssh_command 2>/dev/null || true)
  SERVER_USERNAME="${SSH_COMMAND#ssh }"
  SERVER_USERNAME="${SERVER_USERNAME%@*}"
fi

if [[ -z "$SERVER_USERNAME" ]]; then
  echo "ERROR: Could not determine server username from Terraform outputs."
  echo "Expected one of: server_username, SERVER_USERNAME, or ssh_command."
  exit 1
fi

KUBECONFIG_FILE="$HOME/.kube/config-staging-k8s"
if [[ "${1:-}" == "--" ]]; then
  shift
elif [[ $# -gt 1 && "${2:-}" == "--" ]]; then
  KUBECONFIG_FILE="$1"
  shift
  shift
elif [[ $# -eq 1 ]]; then
  KUBECONFIG_FILE="$1"
  set --
elif [[ $# -gt 1 ]]; then
  echo "Error: Invalid arguments. To run a command, use '--' to separate it." >&2
  echo "Usage: $0 [kubeconfig-path] [-- command...]" >&2
  exit 1
fi

SSH_RETRIES="${SSH_RETRIES:-30}"
SSH_RETRY_DELAY_SECONDS="${SSH_RETRY_DELAY_SECONDS:-10}"
SSH_CONNECT_TIMEOUT_SECONDS="${SSH_CONNECT_TIMEOUT_SECONDS:-10}"

echo "Fetching kubeconfig from $SERVER_USERNAME@$SSH_HOSTNAME..."

wait_for_ssh_ready "$SERVER_USERNAME@$SSH_HOSTNAME" "$SSH_RETRIES" "$SSH_RETRY_DELAY_SECONDS" "$SSH_CONNECT_TIMEOUT_SECONDS"

tmp_kubeconfig="$(mktemp)"
trap 'rm -f "$tmp_kubeconfig"' EXIT

# Fetch kubeconfig and update server URL
ssh -o BatchMode=yes -o ConnectTimeout="$SSH_CONNECT_TIMEOUT_SECONDS" "$SERVER_USERNAME@$SSH_HOSTNAME" \
  'sudo cat /etc/rancher/k3s/k3s.yaml' | \
  sed "s/127.0.0.1/$K8S_API_HOSTNAME/" > "$tmp_kubeconfig"

if [[ ! -s "$tmp_kubeconfig" ]]; then
  echo "ERROR: Retrieved kubeconfig is empty."
  exit 1
fi

mv "$tmp_kubeconfig" "$KUBECONFIG_FILE"
trap - EXIT

chmod 600 "$KUBECONFIG_FILE"

echo "Kubeconfig saved to: $KUBECONFIG_FILE"
echo ""

if [[ $# -gt 0 ]]; then
  echo "Running with KUBECONFIG set:"
  echo "  $*"
  exec env KUBECONFIG="$KUBECONFIG_FILE" "$@"
fi

echo "Run without exporting:"
echo "  KUBECONFIG=$KUBECONFIG_FILE kubectl get nodes"
echo "Or wrap a command directly:"
echo "  $0 $KUBECONFIG_FILE -- kubectl get nodes"
