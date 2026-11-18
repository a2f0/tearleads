#!/bin/sh

set -e

unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
REPO_ROOT="$(git -C "$(dirname -- "$0")" rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Pass --adopt only for an inspected installation from the previous installer.
exec bun run agent-tool hooks install --apply "$@"
