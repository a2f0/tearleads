#!/bin/sh

set -e

REPO_ROOT="$(git -C "$(dirname -- "$0")" rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Pass --adopt only for an inspected installation from the previous installer.
exec bun run agent-tool hooks install --apply "$@"
