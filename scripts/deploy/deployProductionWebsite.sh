#!/usr/bin/env bash
# Deploy the production website directly to Cloudflare.
set -euo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS
REPO_ROOT="$(CDPATH='' cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
exec "$REPO_ROOT/packages/website/scripts/deployWebsite.sh" prod "$@"
