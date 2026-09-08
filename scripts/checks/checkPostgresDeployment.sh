#!/usr/bin/env bash
# Render both database modes without connecting to a server or database.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
TEMPLATE_DIR="$REPO_ROOT/ansible/playbooks/templates"
RENDER_DIR=$(mktemp -d)
trap 'rm -rf "$RENDER_DIR"' EXIT

guard_import=$(awk '/- name: Validate managed PostgreSQL connection/ { getline; print; getline; print }' "$REPO_ROOT/ansible/playbooks/server.yml")
if ! grep -q 'import_tasks: tasks/managedPostgres.yml' <<<"$guard_import" ||
  ! grep -q 'when: postgres_managed | bool' <<<"$guard_import"; then
  echo "ERROR: Production must call the managed Postgres guard." >&2
  exit 1
fi

for managed in true false; do
  host=127.0.0.1
  port=5432
  migration_vars=""
  if [[ "$managed" == true ]]; then
    host=fixture.pg.psdb.cloud
    port=6432
    migration_vars='"postgres_migration_user": "migration.user", "postgres_migration_password": "fixture-migration-password",'
  fi
  cat >"$RENDER_DIR/vars.json" <<EOF
{
  "postgres_managed": $managed,
  "postgres_ssl": $managed,
  "postgres_host": "$host",
  "postgres_port": "$port",
  "postgres_migration_port": "5432",
  $migration_vars
  "postgres_user": "fixture.user",
  "postgres_password": "fixture password # with spaces",
  "postgres_db": "postgres",
  "redis_bind": "127.0.0.1",
  "api_cors_origins": "https://app.example.test",
  "document_sync_cursor_hmac_key": "fixture-cursor-key",
  "garage_enabled": false
}
EOF
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
. "$1/api.env"
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

  for service in "$RENDER_DIR"/*.service; do
    grep -q '^Wants=network-online.target' "$service"
    if [[ "$managed" == true ]]; then
      if grep -q postgresql.service "$service"; then
        echo "ERROR: Managed Postgres must not depend on a local PostgreSQL service." >&2
        exit 1
      fi
    else
      grep -q '^After=.*postgresql.service' "$service"
      grep -q '^Wants=.*postgresql.service' "$service"
    fi
  done
  if [[ "$managed" == true ]]; then
    bash "$REPO_ROOT/scripts/checks/checkManagedPostgresGuard.sh" "$RENDER_DIR/vars.json"
  fi
done

echo "Postgres deployment templates passed."
