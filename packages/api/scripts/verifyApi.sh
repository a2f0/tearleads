#!/usr/bin/env bash
# Confirm the tier's public API hostname answers from the deployed Worker.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $(basename "$0") <staging|prod>" >&2
  exit 1
fi
TIER="$1"
unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS
REPO_ROOT="$(CDPATH='' cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
# shellcheck source=../../../terraform/scripts/common.sh
# shellcheck disable=SC1091
. "$REPO_ROOT/terraform/scripts/common.sh"
load_secrets_env "$TIER"
validate_domain_env

API_HOSTNAME="$(tier_api_hostname "$TIER")"
echo "Verifying https://$API_HOSTNAME/ ..."
curl --fail --silent --show-error --retry 12 --retry-all-errors --retry-delay 5 \
  --max-time 15 "https://$API_HOSTNAME/" >/dev/null
echo "API responds on https://$API_HOSTNAME/."
