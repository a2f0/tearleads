#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

SSH_RETRIES="${SSH_RETRIES:-30}"
SSH_RETRY_DELAY_SECONDS="${SSH_RETRY_DELAY_SECONDS:-10}"
SSH_CONNECT_TIMEOUT_SECONDS="${SSH_CONNECT_TIMEOUT_SECONDS:-10}"

SERVER_IP="$(terraform -chdir="$STACK_DIR" output -raw server_ip)"
SERVER_USERNAME="$(terraform -chdir="$STACK_DIR" output -raw server_username)"

attempt=1
while (( attempt <= SSH_RETRIES )); do
  if ssh -o BatchMode=yes -o ConnectTimeout="$SSH_CONNECT_TIMEOUT_SECONDS" "$SERVER_USERNAME@$SERVER_IP" true >/dev/null 2>&1; then
    break
  fi

  echo "SSH not ready yet (attempt $attempt/$SSH_RETRIES). Retrying in ${SSH_RETRY_DELAY_SECONDS}s..."
  sleep "$SSH_RETRY_DELAY_SECONDS"
  ((attempt++))
done

if (( attempt > SSH_RETRIES )); then
  echo "ERROR: Unable to connect to $SERVER_USERNAME@$SERVER_IP over SSH after $SSH_RETRIES attempts."
  exit 1
fi

if ! command -v ansible-playbook >/dev/null 2>&1; then
  echo "ERROR: ansible-playbook is required for VPN baseline setup."
  echo "Install dependencies via ./ansible/scripts/setup.sh and re-run."
  exit 1
fi

echo "Running Ansible WireGuard bootstrap..."
"$REPO_ROOT/ansible/scripts/run-vpn-prod.sh"

echo ""
echo "Step 2 complete. VPN baseline is configured."
echo "Terraform stack: $STACK_DIR"
