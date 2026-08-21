#!/usr/bin/env bash
# Configure a server tier through its Tailscale hostname.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $(basename "$0") <staging|prod> [ansible-playbook arguments...]" >&2
  exit 1
fi

TIER="$1"
shift

case "$TIER" in
  staging | prod) ;;
  *)
    echo "ERROR: Unsupported server tier: $TIER" >&2
    exit 1
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export ANSIBLE_CONFIG="${SCRIPT_DIR}/../ansible.cfg"
# PostgreSQL tasks become the postgres OS user; keep module temp files in an
# existing system temp dir instead of creating /var/lib/postgresql/.ansible/tmp.
export ANSIBLE_REMOTE_TEMP="${ANSIBLE_REMOTE_TEMP:-/tmp}"
export ANSIBLE_DEPRECATION_WARNINGS="${ANSIBLE_DEPRECATION_WARNINGS:-False}"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../terraform/scripts/common.sh
# shellcheck disable=SC1091
. "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env "$TIER"
validate_aws_env

STACK_DIR="$REPO_ROOT/terraform/stacks/$TIER/server"
BACKEND_CONFIG="$(get_backend_config)"
terraform -chdir="$STACK_DIR" init -backend-config="$BACKEND_CONFIG" >&2

# The resolver deliberately returns only the Tailscale MagicDNS target. Public
# server IPs are never used for SSH.
SSH_TARGET="${SSH_TARGET:-$(resolve_stack_ssh_target "$STACK_DIR")}"
HOSTNAME="${SSH_TARGET#*@}"
USERNAME="${SSH_TARGET%@*}"
DOMAIN="${TF_VAR_domain:-}"
TUNNEL_TOKEN=$(terraform -chdir="$STACK_DIR" output -raw tunnel_token 2>/dev/null) || true

if [[ "$SSH_TARGET" != *@* || -z "$HOSTNAME" || -z "$USERNAME" ]]; then
  echo "ERROR: Could not parse hostname or username from resolved SSH target." >&2
  echo "       Resolved target: $SSH_TARGET" >&2
  exit 1
fi

if [[ -z "$TUNNEL_TOKEN" ]]; then
  echo "ERROR: Could not resolve Cloudflare tunnel token from terraform outputs." >&2
  echo "       Run 'terraform apply' in $STACK_DIR first." >&2
  exit 1
fi

INVENTORY_FILE=$(mktemp "/tmp/symcrypt-${TIER}-inventory-XXXXXX")
trap 'rm -f "$INVENTORY_FILE"' EXIT

printf '[all]\n%s ansible_user=%s\n' "$HOSTNAME" "$USERNAME" >"$INVENTORY_FILE"

CLOUDFLARE_TUNNEL_TOKEN="$TUNNEL_TOKEN" ansible-playbook -i "$INVENTORY_FILE" \
  -e "deployment_tier=${TIER}" \
  -e "domain=${DOMAIN}" \
  "$SCRIPT_DIR/../playbooks/server.yml" "$@"
