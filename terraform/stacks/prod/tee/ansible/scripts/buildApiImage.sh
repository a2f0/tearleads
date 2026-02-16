#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname "$0")" && pwd)"
ANSIBLE_ROOT="$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd)"
INVENTORY="${TEE_ANSIBLE_INVENTORY:-localhost,}"

ansible-playbook -i "$INVENTORY" "$ANSIBLE_ROOT/playbooks/buildApiImage.yml" "$@"
