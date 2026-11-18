#!/bin/sh

set -e

for name in $(git rev-parse --local-env-vars); do unset "$name"; done
REPO_ROOT="$(CDPATH='' cd -P -- "$(dirname -- "$0")/../.." && pwd -P)"
cd "$REPO_ROOT"
git_root=$(git rev-parse --show-toplevel)
if [ "$(CDPATH='' cd -P -- "$git_root" && pwd -P)" != "$REPO_ROOT" ]; then
  echo "This command requires its own Git checkout: $REPO_ROOT" >&2
  exit 1
fi

# Pass --adopt only for an inspected installation from the previous installer.
exec bun run agent-tool hooks install --apply "$@"
