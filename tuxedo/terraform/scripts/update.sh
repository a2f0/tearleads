#!/bin/sh
set -eu
if [ -n "${TF_WORKSPACE_TUXEDO:-}" ]; then
  export TF_WORKSPACE="$TF_WORKSPACE_TUXEDO"
fi
terraform -chdir="$(dirname "$0")/.." init -upgrade "$@"
