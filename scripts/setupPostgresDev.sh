#!/bin/sh
set -eu

echo "Setting up Postgres for dev..."

OS_NAME="$(uname -s)"
DB_NAME="tearleads_development"
PG_USER="${USER:-${LOGNAME:-}}"

ensure_linux_role_exists() {
  role_name="$1"

  if [ "${OS_NAME}" != "Linux" ] || [ -z "${role_name}" ]; then
    return
  fi

  if ! command -v psql >/dev/null 2>&1; then
    return
  fi

  if ! command -v sudo >/dev/null 2>&1; then
    return
  fi

  role_exists="$(sudo -u postgres psql --dbname postgres --tuples-only --quiet --no-align -c "SELECT 1 FROM pg_roles WHERE rolname='${role_name}'" 2>/dev/null | tr -d '[:space:]')"
  if [ "${role_exists}" = "1" ]; then
    return
  fi

  if sudo -u postgres createuser "${role_name}" >/dev/null 2>&1; then
    echo "Created Postgres role ${role_name}."
    return
  fi

  echo "Postgres role ${role_name} does not exist and could not be created automatically." >&2
  echo "Run: sudo -u postgres createuser ${role_name}" >&2
  exit 1
}

match_formula() {
  if command -v rg >/dev/null 2>&1; then
    rg "^postgresql(@[0-9]+)?$"
  else
    grep -E "^postgresql(@[0-9]+)?$"
  fi
}

ensure_postgres_binaries_linux() {
  has_client=0
  has_server=0

  if command -v psql >/dev/null 2>&1 && command -v createdb >/dev/null 2>&1; then
    has_client=1
  fi

  if command -v postgres >/dev/null 2>&1 || command -v pg_ctlcluster >/dev/null 2>&1; then
    has_server=1
  fi

  if [ "${has_client}" -eq 1 ] && [ "${has_server}" -eq 1 ]; then
    return
  fi

  if ! command -v apt-get >/dev/null 2>&1; then
    echo "PostgreSQL tools/server are missing and apt-get is unavailable." >&2
    echo "Install PostgreSQL server/client for your distro, then rerun." >&2
    exit 1
  fi

  if ! command -v sudo >/dev/null 2>&1; then
    echo "PostgreSQL tools/server are missing and sudo is not available." >&2
    echo "Run these manually, then rerun:" >&2
    echo "  apt-get update && apt-get install -y postgresql postgresql-client" >&2
    exit 1
  fi

  echo "Installing PostgreSQL server/client via apt-get..."
  sudo apt-get update >/dev/null
  sudo apt-get install -y postgresql postgresql-client >/dev/null

  if ! command -v psql >/dev/null 2>&1 || ! command -v createdb >/dev/null 2>&1; then
    echo "PostgreSQL installation completed but psql/createdb are still missing." >&2
    exit 1
  fi

  if ! command -v postgres >/dev/null 2>&1 && ! command -v pg_ctlcluster >/dev/null 2>&1; then
    echo "PostgreSQL server tools are still missing after install." >&2
    exit 1
  fi
}

start_postgres_macos() {
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew is required but not found in PATH." >&2
    exit 1
  fi

  postgres_formula="$(brew list --formula | match_formula | head -n1 || true)"
  if [ -z "${postgres_formula}" ]; then
    echo "PostgreSQL not found via Homebrew. Installing..." >&2
    brew install postgresql
    postgres_formula="$(brew list --formula | match_formula | head -n1 || true)"
    if [ -z "${postgres_formula}" ]; then
      echo "PostgreSQL install succeeded but formula not detected." >&2
      exit 1
    fi
  fi

  # Ensure psql/createdb from the selected formula are reachable (keg-only formulas).
  PATH="$(brew --prefix "${postgres_formula}")/bin:${PATH}"
  export PATH

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

  echo "Postgres service started (${postgres_formula})."
}

start_pg_cluster_linux() {
  if ! command -v pg_ctlcluster >/dev/null 2>&1 || ! command -v pg_lsclusters >/dev/null 2>&1; then
    return 1
  fi

  cluster="$(pg_lsclusters -h 2>/dev/null | awk 'NR==1 {next} $1 != "" {print $1":"$2; exit}')"
  if [ -z "${cluster}" ]; then
    return 1
  fi

  version="${cluster%%:*}"
  name="${cluster#*:}"

  if command -v sudo >/dev/null 2>&1 && sudo pg_ctlcluster "${version}" "${name}" start >/dev/null 2>&1; then
    return 0
  fi

  if pg_ctlcluster "${version}" "${name}" start >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

start_pg_service_linux() {
  service_name="$1"

  if command -v systemctl >/dev/null 2>&1; then
    if systemctl is-active --quiet "${service_name}" 2>/dev/null; then
      return 0
    fi
    if command -v sudo >/dev/null 2>&1 && sudo systemctl start "${service_name}" >/dev/null 2>&1; then
      return 0
    fi
    if systemctl start "${service_name}" >/dev/null 2>&1; then
      return 0
    fi
  fi

  if command -v service >/dev/null 2>&1; then
    if command -v sudo >/dev/null 2>&1 && sudo service "${service_name}" start >/dev/null 2>&1; then
      return 0
    fi
    if service "${service_name}" start >/dev/null 2>&1; then
      return 0
    fi
  fi

  return 1
}

start_postgres_linux() {
  ensure_postgres_binaries_linux

  if command -v pg_isready >/dev/null 2>&1 && pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
    echo "Postgres service already running."
    return
  fi

  started=0

  # Ubuntu/Debian often use versioned clusters managed via pg_ctlcluster.
  if start_pg_cluster_linux; then
    started=1
  fi

  if [ "${started}" -eq 0 ]; then
    if start_pg_service_linux postgresql; then
      started=1
    elif command -v systemctl >/dev/null 2>&1; then
      detected_unit="$(systemctl list-unit-files 'postgresql*.service' --no-legend 2>/dev/null | awk 'NR==1 {print $1}')"
      if [ -n "${detected_unit}" ]; then
        service_name="${detected_unit%.service}"
        if start_pg_service_linux "${service_name}"; then
          started=1
        fi
      fi
    fi
  fi

  if command -v pg_isready >/dev/null 2>&1; then
    if ! pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
      echo "Postgres is not reachable at localhost:5432." >&2
      echo "Start it manually and rerun. For Ubuntu, try:" >&2
      echo "  sudo pg_ctlcluster <version> <cluster> start" >&2
      echo "  sudo systemctl start postgresql" >&2
      exit 1
    fi
  elif [ "${started}" -eq 0 ]; then
    echo "Unable to verify Postgres readiness (pg_isready missing)." >&2
    echo "Ensure PostgreSQL is running, then rerun." >&2
    exit 1
  fi

  echo "Postgres service started (Linux)."
}

provision_dev_db() {
  psql_check_output=""
  psql_status=1
  createdb_status=1
  createdb_output=""

  if [ -n "${PG_USER}" ]; then
    set +e
    psql_check_output="$(PGUSER="${PG_USER}" psql --dbname postgres --tuples-only --quiet --no-align -c "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" 2>&1)"
    psql_status=$?
    set -e
    if [ "${psql_status}" -ne 0 ] && echo "${psql_check_output}" | grep -q "role .* does not exist"; then
      ensure_linux_role_exists "${PG_USER}"
      set +e
      psql_check_output="$(PGUSER="${PG_USER}" psql --dbname postgres --tuples-only --quiet --no-align -c "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" 2>&1)"
      psql_status=$?
      set -e
    fi
    db_exists="$(printf '%s\n' "${psql_check_output}" | tr -d '[:space:]')"
  else
    set +e
    psql_check_output="$(psql --dbname postgres --tuples-only --quiet --no-align -c "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" 2>&1)"
    psql_status=$?
    set -e
    db_exists="$(printf '%s\n' "${psql_check_output}" | tr -d '[:space:]')"
  fi

  if [ "${db_exists}" = "1" ]; then
    echo "Database ${DB_NAME} already exists."
    return
  fi

  if [ -n "${PG_USER}" ]; then
    set +e
    createdb_output=$(PGUSER="${PG_USER}" createdb "${DB_NAME}" 2>&1)
    createdb_status=$?
    set -e
  else
    set +e
    createdb_output=$(createdb "${DB_NAME}" 2>&1)
    createdb_status=$?
    set -e
  fi

  if [ ${createdb_status} -eq 0 ]; then
    echo "Created database ${DB_NAME}."
  elif echo "${createdb_output}" | grep -q "already exists"; then
    echo "Database ${DB_NAME} already exists."
  elif echo "${createdb_output}" | grep -q "permission denied to create database"; then
    if [ "${OS_NAME}" = "Linux" ] && [ -n "${PG_USER}" ]; then
      if command -v sudo >/dev/null 2>&1 && sudo -u postgres createdb -O "${PG_USER}" "${DB_NAME}" >/dev/null 2>&1; then
        echo "Created database ${DB_NAME} via postgres superuser."
        return
      fi
      echo "Role ${PG_USER} lacks CREATEDB permission." >&2
      echo "Run one of the following, then rerun:" >&2
      echo "  sudo -u postgres createdb -O ${PG_USER} ${DB_NAME}" >&2
      echo "  sudo -u postgres psql -d postgres -c \"ALTER ROLE ${PG_USER} CREATEDB;\"" >&2
      exit 1
    fi
    echo "Failed to create database ${DB_NAME}: permission denied." >&2
    echo "${createdb_output}" >&2
    exit 1
  elif [ ${psql_status} -ne 0 ]; then
    echo "Failed to check for database ${DB_NAME}; createdb also failed." >&2
    echo "${psql_check_output}" >&2
    echo "${createdb_output}" >&2
    exit 1
  else
    echo "Failed to create database ${DB_NAME}." >&2
    echo "${createdb_output}" >&2
    exit 1
  fi
}

case "${OS_NAME}" in
  Darwin)
    start_postgres_macos
    ;;
  Linux)
    start_postgres_linux
    ;;
  *)
    echo "setupPostgresDev.sh supports macOS and Linux only." >&2
    exit 1
    ;;
esac

provision_dev_db

echo "Suggested environment variables for dev:"
echo "  export PGHOST=localhost"
echo "  export PGPORT=5432"
if [ -n "${PG_USER}" ]; then
  echo "  export PGUSER=${PG_USER}"
fi
echo "  export PGDATABASE=tearleads_development"
