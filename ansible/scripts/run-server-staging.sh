#!/bin/sh
# Configure the staging server
#
# Loads .secrets/root.env + .secrets/staging.env so the dynamic inventory
# script can reach the Terraform S3 backend for host resolution.

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export ANSIBLE_CONFIG="${SCRIPT_DIR}/../ansible.cfg"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../terraform/scripts/common.sh
. "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env staging
validate_aws_env

# Ensure terraform backend is initialized for the inventory script
BACKEND_CONFIG="$(get_backend_config)"
terraform -chdir="$REPO_ROOT/terraform/stacks/staging/server" init \
  -backend-config="$BACKEND_CONFIG" >&2

ansible-playbook -i "$SCRIPT_DIR/../inventories/staging.sh" \
  "$SCRIPT_DIR/../playbooks/server.yml" "$@"
