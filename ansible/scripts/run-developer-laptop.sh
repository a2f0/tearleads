#!/bin/sh
# Install developer tools on a local laptop (Linux Mint 21.x / Ubuntu 22.04)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

ansible-playbook -i localhost, "$SCRIPT_DIR/../playbooks/developerLaptop.yml" "$@"
