#!/bin/sh
set -eu
SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)
export ANSIBLE_CONFIG="$SCRIPT_DIR/../ansible/ansible.cfg"

"$SCRIPT_DIR/../tuxedo/terraform/scripts/init.sh"
ansible-playbook -i "$SCRIPT_DIR/../ansible/inventories/tuxedo.sh" "$SCRIPT_DIR/../ansible/playbooks/tuxedo.yml"
