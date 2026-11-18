#!/usr/bin/env bash
# Delete a tier's app and demo asset Workers after the edge stack has detached
# their hostnames.
set -euo pipefail
if [[ $# -ne 1 ]]; then
  echo "Usage: $(basename "$0") <staging|prod>" >&2
  exit 1
fi
TIER="$1"
unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
REPO_ROOT="$(git -C "$(dirname -- "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
# shellcheck source=../../../terraform/scripts/teardownGuard.sh
# shellcheck disable=SC1091
. "$REPO_ROOT/terraform/scripts/teardownGuard.sh"
require_teardown_authorized "$TIER"
# shellcheck source=../../../terraform/scripts/common.sh
# shellcheck disable=SC1091
. "$REPO_ROOT/terraform/scripts/common.sh"
load_secrets_env "$TIER"
export_wrangler_env
cd "$REPO_ROOT/packages/app-web"
for variant in app demo; do
  bun run "destroy:$variant" --env "$TIER" --force
done
