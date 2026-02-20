#!/bin/sh
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ansible-playbook -i "$SCRIPT_DIR/../inventories/vault-prod.sh" "$SCRIPT_DIR/../playbooks/vault.yml" "$@"
