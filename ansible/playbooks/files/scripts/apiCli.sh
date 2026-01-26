#!/bin/sh
set -e

ENV_FILE="/opt/rapid-api/.env"

if [ ! -f "$ENV_FILE" ]; then
    echo "Error: Environment file not found: $ENV_FILE" >&2
    exit 1
fi

set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a

exec /usr/bin/node /opt/rapid-api/dist/apiCli.cjs "$@"
