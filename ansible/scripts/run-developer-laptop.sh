#!/bin/sh
# Install developer tools on a local laptop (Linux or macOS)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export ANSIBLE_CONFIG="${SCRIPT_DIR}/../ansible.cfg"

ansible-playbook -i localhost, --ask-become-pass "$SCRIPT_DIR/../playbooks/developerLaptop.yml" "$@"
