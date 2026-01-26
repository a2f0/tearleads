#!/bin/sh
set -e

set -a
# shellcheck source=/dev/null
. /opt/rapid-api/.env
set +a

exec /usr/bin/node /opt/rapid-api/dist/apiCli.cjs "$@"
