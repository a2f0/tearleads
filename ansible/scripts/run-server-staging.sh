#!/bin/sh
# Configure the staging server
#
# Loads .secrets/root.env + .secrets/staging.env, resolves the server
# hostname and username from Terraform outputs, and runs the Ansible
# server playbook.

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export ANSIBLE_CONFIG="${SCRIPT_DIR}/../ansible.cfg"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../terraform/scripts/common.sh
. "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env staging
validate_aws_env

# Ensure terraform backend is initialized
STACK_DIR="$REPO_ROOT/terraform/stacks/staging/server"
BACKEND_CONFIG="$(get_backend_config)"
terraform -chdir="$STACK_DIR" init -backend-config="$BACKEND_CONFIG" >&2

# Resolve hostname and username from terraform outputs
HOSTNAME=$(terraform -chdir="$STACK_DIR" output -raw ssh_hostname 2>/dev/null) || true
USERNAME=$(terraform -chdir="$STACK_DIR" output -raw server_username 2>/dev/null) || true

if [ -z "$HOSTNAME" ] || [ -z "$USERNAME" ]; then
  echo "ERROR: Could not resolve hostname or username from terraform outputs." >&2
  echo "       Run 'terraform apply' in $STACK_DIR first." >&2
  exit 1
fi

INVENTORY_FILE=$(mktemp -t tearleads-staging-inventory)
# shellcheck disable=SC2064
trap "rm -f '$INVENTORY_FILE'" EXIT

printf '[all]\n%s ansible_user=%s\n' "$HOSTNAME" "$USERNAME" > "$INVENTORY_FILE"

ansible-playbook -i "$INVENTORY_FILE" \
  "$SCRIPT_DIR/../playbooks/server.yml" "$@"
