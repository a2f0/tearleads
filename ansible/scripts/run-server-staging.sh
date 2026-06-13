#!/usr/bin/env bash
# Configure the staging server
#
# Loads .secrets/root.env + .secrets/staging.env, resolves the server
# hostname and username from Terraform outputs, and runs the Ansible
# server playbook.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export ANSIBLE_CONFIG="${SCRIPT_DIR}/../ansible.cfg"
# PostgreSQL tasks become the postgres OS user; keep module temp files in an
# existing system temp dir instead of creating /var/lib/postgresql/.ansible/tmp.
export ANSIBLE_REMOTE_TEMP="${ANSIBLE_REMOTE_TEMP:-/tmp}"
export ANSIBLE_DEPRECATION_WARNINGS="${ANSIBLE_DEPRECATION_WARNINGS:-False}"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../terraform/scripts/common.sh
. "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env staging
validate_aws_env

# Ensure terraform backend is initialized
STACK_DIR="$REPO_ROOT/terraform/stacks/staging/server"
BACKEND_CONFIG="$(get_backend_config)"
terraform -chdir="$STACK_DIR" init -backend-config="$BACKEND_CONFIG" >&2

# Resolve hostname, username, and domain from terraform outputs
HOSTNAME=$(terraform -chdir="$STACK_DIR" output -raw ssh_hostname 2>/dev/null) || true
USERNAME=$(terraform -chdir="$STACK_DIR" output -raw server_username 2>/dev/null) || true
DOMAIN="${TF_VAR_domain:-}"

if [ -z "$HOSTNAME" ] || [ -z "$USERNAME" ]; then
  echo "ERROR: Could not resolve hostname or username from terraform outputs." >&2
  echo "       Run 'terraform apply' in $STACK_DIR first." >&2
  exit 1
fi

SSH_TARGET="$USERNAME@$HOSTNAME"
wait_for_ssh_ready "$SSH_TARGET"

INVENTORY_FILE=$(mktemp /tmp/tearleads-staging-inventory-XXXXXX)
# shellcheck disable=SC2064
trap "rm -f '$INVENTORY_FILE'" EXIT

printf '[all]\n%s ansible_user=%s\n' "$HOSTNAME" "$USERNAME" > "$INVENTORY_FILE"

ansible-playbook -i "$INVENTORY_FILE" \
  -e "domain=${DOMAIN}" \
  "$SCRIPT_DIR/../playbooks/server.yml" "$@"
