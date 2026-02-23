#!/bin/sh
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export ANSIBLE_CONFIG="${SCRIPT_DIR}/../ansible.cfg"
ansible-playbook -i "$SCRIPT_DIR/../inventories/vault-prod.sh" "$SCRIPT_DIR/../playbooks/vault.yml" "$@"
