#!/bin/sh
set -eu

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec sh "${REPO_ROOT}/scripts/workstationBootstrap/run.sh" "$@"
