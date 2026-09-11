#!/usr/bin/env bash
# Render both database modes without connecting to a server or database.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
TEMPLATE_DIR="$REPO_ROOT/ansible/playbooks/templates"
RENDER_DIR=$(mktemp -d)
trap 'rm -rf "$RENDER_DIR"' EXIT

if ! ansible-playbook -i localhost, --connection local \
  "$REPO_ROOT/ansible/tests/databaseDeployment.yml" \
  </dev/null >"$RENDER_DIR/config-check.log" 2>&1; then
  cat "$RENDER_DIR/config-check.log" >&2
  exit 1
fi

bash "$REPO_ROOT/scripts/checks/checkManagedS3Guard.sh"

require_setting() {
  if ! grep -q "$2" "$1"; then
    echo "ERROR: $(basename "$1") is missing $2" >&2
    exit 1
  fi
}

for managed in true false; do
  host=127.0.0.1
  port=5432
  migration_vars=""
  if [[ "$managed" == true ]]; then
    host=fixture.pg.psdb.cloud
    port=6432
    migration_vars='"postgres_migration_port": "5432", "postgres_migration_user": "migration.user", "postgres_migration_password": "fixture-migration-password",'
  fi
  cat >"$RENDER_DIR/vars.json" <<EOF
{
  "postgres_managed": $managed,
  "postgres_ssl": $managed,
  "postgres_host": "$host",
  "postgres_port": "$port",
  $migration_vars
  "postgres_user": "fixture.user",
  "postgres_password": "fixture password # with spaces",
  "postgres_db": "postgres",
  "redis_bind": "127.0.0.1",
  "api_cors_origins": "https://app.example.test",
  "document_sync_cursor_hmac_key": "fixture-cursor-key"
}
EOF
  python3 - "$RENDER_DIR" <<'STORAGE_VARS'
import json
from pathlib import Path
import sys

root = Path(sys.argv[1])
values = json.loads((root / 'vars.json').read_text())
secret = """fixture ' "$S3_TOKEN" `touch unexpected` # &; | * ?"""
values.update({
    "blob_object_store": "s3",
    "blob_s3_bucket": "fixture-blobs",
    "blob_s3_region": "us-east-1",
    "blob_s3_endpoint": "",
    "blob_s3_force_path_style": False,
    "blob_s3_access_key_id": "fixture-access-key",
    "blob_s3_secret_access_key": secret,
    "blob_s3_key_prefix": "",
})
(root / 'storage-secret').write_text(secret)
(root / 'vars.json').write_text(json.dumps(values))
STORAGE_VARS
  for template in \
    etc/tearleads/api.env \
    etc/tearleads/migrations.env \
    etc/systemd/system/tearleads-api.service \
    etc/systemd/system/tearleads-blob-gc.service \
    etc/systemd/system/tearleads-stripe-seat-sync.service; do
    rendered="$RENDER_DIR/$(basename "$template")"
    if ! ansible localhost --connection local -i localhost, \
      -m ansible.builtin.template \
      -a "src=$TEMPLATE_DIR/$template.j2 dest=$rendered mode=0600" \
      -e ansible_python_interpreter=auto_silent \
      -e "@$RENDER_DIR/vars.json" </dev/null >/dev/null 2>"$RENDER_DIR/ansible.stderr"; then
      cat "$RENDER_DIR/ansible.stderr" >&2
      exit 1
    fi
  done

  env -i PATH="$PATH" sh -s -- "$RENDER_DIR" "$managed" "$port" <<'VERIFY_ENV'
set -eu
cd "$1"
. "$1/api.env"
test "$BLOB_OBJECT_STORE" = s3
test "$BLOB_OBJECT_STORE_S3_BUCKET" = fixture-blobs
test "$BLOB_OBJECT_STORE_S3_ACCESS_KEY_ID" = fixture-access-key
test "$BLOB_OBJECT_STORE_S3_SECRET_ACCESS_KEY" = "$(cat storage-secret)"
test ! -e unexpected
test "$BLOB_OBJECT_STORE_S3_FORCE_PATH_STYLE" = false
test "$BLOB_OBJECT_STORE_S3_REGION" = us-east-1
test -z "$BLOB_OBJECT_STORE_S3_ENDPOINT"
test -z "${BLOB_OBJECT_STORE_S3_KEY_PREFIX:-}"
test "$POSTGRES_SSL" = "$2"
test "$POSTGRES_SSL_REJECT_UNAUTHORIZED" = true
test "$POSTGRES_PASSWORD" = "fixture password # with spaces"
test "$POSTGRES_DATABASE" = postgres
test "$POSTGRES_PORT" = "$3"
test "$POSTGRES_USER" = fixture.user
. "$1/migrations.env"
test "$POSTGRES_PORT" = 5432
if [ "$2" = true ]; then
  test "$POSTGRES_USER" = migration.user
  test "$POSTGRES_PASSWORD" = fixture-migration-password
else
  test "$POSTGRES_USER" = fixture.user
  test "$POSTGRES_PASSWORD" = "fixture password # with spaces"
fi
VERIFY_ENV

  if grep -Eq 'POSTGRES_MIGRATION_|fixture-migration-password|migration[.]user' "$RENDER_DIR/api.env"; then
    echo "ERROR: Runtime environment contains migration credentials." >&2
    exit 1
  fi

  for service in "$RENDER_DIR"/*.service; do
    require_setting "$service" '^Wants=network-online.target'
    require_setting "$service" '^ProtectSystem=strict$'
    require_setting "$service" '^NoNewPrivileges=true$'
    if grep -q '^ReadWritePaths=' "$service"; then
      echo "ERROR: API and maintenance services must not write application executables." >&2
      exit 1
    fi
    if [[ "$managed" == true ]]; then
      if grep -q postgresql.service "$service"; then
        echo "ERROR: Managed Postgres must not depend on a local PostgreSQL service." >&2
        exit 1
      fi
    else
      require_setting "$service" '^After=.*postgresql.service'
      require_setting "$service" '^Wants=.*postgresql.service'
    fi
  done
  if [[ "$managed" == true ]]; then
    bash "$REPO_ROOT/scripts/checks/checkManagedPostgresGuard.sh" "$RENDER_DIR/vars.json"
  fi
done

echo "Postgres deployment templates passed."
