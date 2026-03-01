#!/usr/bin/env sh
set -eu

ROOT_DIR="$(cd -- "$(dirname -- "$0")/../.." && pwd -P)"
DEV_ENV_FILE="${ROOT_DIR}/.secrets/dev.env"

if [ "$#" -eq 0 ]; then
  echo "Usage: runWithDevEnv.sh <command> [args...]" >&2
  exit 1
fi

if [ -f "${DEV_ENV_FILE}" ]; then
  set -a
  # shellcheck source=/dev/null
  . "${DEV_ENV_FILE}"
  set +a
fi

exec "$@"
