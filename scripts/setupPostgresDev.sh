#!/usr/bin/env bash
set -euo pipefail

echo "Setting up Postgres for dev..."

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "setupPostgresDev.sh supports macOS only." >&2
  exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required but not found in PATH." >&2
  exit 1
fi

match_formula() {
  if command -v rg >/dev/null 2>&1; then
    rg "^postgresql(@[0-9]+)?$"
  else
    grep -E "^postgresql(@[0-9]+)?$"
  fi
}

set +o pipefail
postgres_formula="$(brew list --formula | match_formula | head -n1 || true)"
set -o pipefail

if [[ -z "${postgres_formula}" ]]; then
  echo "PostgreSQL not found via Homebrew. Installing..." >&2
  brew install postgresql
  set +o pipefail
  postgres_formula="$(brew list --formula | match_formula | head -n1 || true)"
  set -o pipefail
  if [[ -z "${postgres_formula}" ]]; then
    echo "PostgreSQL install succeeded but formula not detected." >&2
    exit 1
  fi
fi

if ! brew services start "${postgres_formula}" >/dev/null; then
  brew_prefix="$(brew --prefix)"
  data_dir="${brew_prefix}/var/${postgres_formula}"
  postgres_bin="$(brew --prefix "${postgres_formula}")/bin/postgres"

  echo "Failed to start Postgres via brew services." >&2
  echo "Try one of the following:" >&2
  echo "  brew services start ${postgres_formula}" >&2
  echo "  ${postgres_bin} -D ${data_dir}" >&2
  exit 1
fi

pg_user="${USER:-${LOGNAME:-}}"
db_name="tearleads_development"
createdb_args=()
psql_args=(--dbname postgres --tuples-only --quiet --no-align)
if [[ -n "${pg_user}" ]]; then
  createdb_args+=("--username" "${pg_user}")
  psql_args+=("--username" "${pg_user}")
fi

set +e
db_exists="$(psql "${psql_args[@]}" -c "SELECT 1 FROM pg_database WHERE datname='${db_name}'" 2>/dev/null | tr -d '[:space:]')"
psql_status=$?
set -e

if [[ "${db_exists}" == "1" ]]; then
  echo "Database ${db_name} already exists."
else
  set +e
  createdb_output="$(createdb "${createdb_args[@]}" "${db_name}" 2>&1)"
  createdb_status=$?
  set -e

  if [[ ${createdb_status} -eq 0 ]]; then
    echo "Created database ${db_name}."
  elif echo "${createdb_output}" | rg -q "already exists"; then
    echo "Database ${db_name} already exists."
  elif [[ ${psql_status} -ne 0 ]]; then
    echo "Failed to check for database ${db_name}; createdb also failed." >&2
    echo "${createdb_output}" >&2
  else
    echo "Failed to create database ${db_name}." >&2
    echo "${createdb_output}" >&2
  fi
fi

echo "Postgres service started (${postgres_formula})."
echo "Suggested environment variables for dev:"
echo "  export PGHOST=localhost"
echo "  export PGPORT=5432"
if [[ -n "${pg_user}" ]]; then
  echo "  export PGUSER=${pg_user}"
fi
echo "  export PGDATABASE=tearleads_development"
