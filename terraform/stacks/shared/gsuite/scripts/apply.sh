#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=./auth.sh
source "$SCRIPT_DIR/auth.sh"

hydrate_googleworkspace_auth "$REPO_ROOT"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud CLI is required" >&2
  exit 1
fi

if [[ -z "${TF_VAR_googleworkspace_access_token:-}" && -z "${TF_VAR_googleworkspace_credentials:-}" && -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]]; then
  TF_VAR_googleworkspace_access_token="$(gcloud auth print-access-token)"
  export TF_VAR_googleworkspace_access_token
fi

terraform -chdir="$STACK_DIR" apply "$@"
