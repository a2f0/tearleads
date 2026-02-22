#!/bin/sh
# Install developer tools on a local laptop (Linux Mint 22 / Ubuntu 24.04)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

ansible-playbook -i localhost, "$SCRIPT_DIR/../playbooks/developerLaptop.yml" "$@"
