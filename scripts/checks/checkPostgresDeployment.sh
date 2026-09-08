#!/usr/bin/env bash
# Render both database modes without connecting to a server or database.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
TEMPLATE_DIR="$REPO_ROOT/ansible/playbooks/templates"
RENDER_DIR=$(mktemp -d)
trap 'rm -rf "$RENDER_DIR"' EXIT

for managed in true false; do
  cat >"$RENDER_DIR/vars.json" <<EOF
{
  "postgres_managed": $managed,
  "postgres_ssl": $managed,
  "postgres_host": "fixture.pg.psdb.cloud",
  "postgres_port": "6432",
  "postgres_migration_port": "5432",
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

  env -i PATH="$PATH" sh -s -- "$RENDER_DIR/api.env" "$managed" <<'VERIFY_ENV'
set -eu
. "$1"
test "$POSTGRES_SSL" = "$2"
test "$POSTGRES_SSL_REJECT_UNAUTHORIZED" = true
test "$POSTGRES_PASSWORD" = "fixture password # with spaces"
test "$POSTGRES_DATABASE" = postgres
test "$POSTGRES_PORT" = 6432
test "$POSTGRES_MIGRATION_PORT" = 5432
VERIFY_ENV

  for service in "$RENDER_DIR"/*.service; do
    if [[ "$managed" == true ]]; then
      if grep -q postgresql.service "$service"; then
        echo "ERROR: Managed Postgres must not depend on a local PostgreSQL service." >&2
        exit 1
      fi
      grep -q '^Wants=network-online.target' "$service"
    else
      grep -q '^After=.*postgresql.service' "$service"
      grep -q '^Wants=.*postgresql.service' "$service"
    fi
  done
done

echo "Postgres deployment templates passed."
