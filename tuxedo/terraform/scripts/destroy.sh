#!/bin/bash
set -eu
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../terraform/scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

setup_ssh_host_keys

terraform -chdir="$STACK_DIR" destroy "$@"
