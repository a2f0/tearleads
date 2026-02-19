#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=./auth.sh
source "$SCRIPT_DIR/auth.sh"

hydrate_googleworkspace_auth "$REPO_ROOT"

terraform -chdir="$STACK_DIR" apply "$@"
