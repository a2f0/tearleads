#!/bin/sh
set -eu
export TF_WORKSPACE="${TF_WORKSPACE_K8S:?TF_WORKSPACE_K8S is not set}"
terraform -chdir="$(dirname "$0")/.." plan "$@"
