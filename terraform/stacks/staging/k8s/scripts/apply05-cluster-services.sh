#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"
APPS_DIR="$SCRIPT_DIR/../../apps"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env staging

terraform -chdir="$APPS_DIR" init -backend-config="$(get_backend_config)"
terraform -chdir="$APPS_DIR" apply "$@"
