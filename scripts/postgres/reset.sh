#!/bin/sh
set -eu

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"

echo "Resetting local Postgres dev database..."

# 1) Drop dev database (requires explicit confirmation flag).
"$SCRIPT_DIR/dropPostgresDb.ts" --yes

# 2) Ensure local Postgres is running and recreate dev database.
"$SCRIPT_DIR/setupPostgresDev.sh"

# 3) Run pending migrations.
"$SCRIPT_DIR/runPostgresMigration.sh" "$@"

echo "Postgres dev reset complete."
