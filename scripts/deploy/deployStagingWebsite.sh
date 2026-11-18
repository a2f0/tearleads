#!/usr/bin/env bash
# Deploy the staging website directly to Cloudflare.
set -euo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
REPO_ROOT="$(git -C "$(dirname -- "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
exec "$REPO_ROOT/packages/website/scripts/deployWebsite.sh" staging "$@"
