#!/bin/sh

set -e

unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS
REPO_ROOT="$(CDPATH='' cd -P -- "$(dirname -- "$0")/../.." && pwd -P)"
cd "$REPO_ROOT"

# Pass --adopt only for an inspected installation from the previous installer.
exec bun run agent-tool hooks install --apply "$@"
