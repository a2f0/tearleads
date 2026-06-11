#!/bin/bash
# Configure the prod server
#
# Loads .secrets/root.env + .secrets/prod.env so the dynamic inventory
# script can reach the Terraform S3 backend for host resolution.

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export ANSIBLE_CONFIG="${SCRIPT_DIR}/../ansible.cfg"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../terraform/scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env prod

ansible-playbook -i "$SCRIPT_DIR/../inventories/prod.sh" \
  "$SCRIPT_DIR/../playbooks/server.yml" "$@"
