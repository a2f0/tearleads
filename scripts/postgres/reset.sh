#!/bin/sh
set -eu

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"

echo "Resetting local Postgres dev database..."

"$SCRIPT_DIR/dropPostgresDb.ts" --yes
"$SCRIPT_DIR/setupPostgresDev.sh"
"$SCRIPT_DIR/runPostgresMigration.sh" "$@"

echo "Postgres dev reset complete."
