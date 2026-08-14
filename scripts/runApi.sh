#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: sh scripts/runApi.sh [pglite|postgres|sqlite|turso] [-- dev args]

Modes:
  pglite, pg-lite, memory      Run with in-memory PGlite. This is the default.
  postgres, persistent         Run with persistent Postgres.
  sqlite                       Run with local SQLite.
  turso                        Run against a remote Turso database.

You can also set API_DATABASE instead of passing a mode argument.
EOF
}

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
API_DIR="$(cd -- "$SCRIPT_DIR/../packages/api" && pwd -P)" || exit 1
DATABASE_MODE="${API_DATABASE:-pglite}"

if [ "$#" -gt 0 ]; then
  case "$1" in
    postgres | --postgres | persistent | --persistent)
      DATABASE_MODE="postgres"
      shift
      ;;
    sqlite | --sqlite)
      DATABASE_MODE="sqlite"
      shift
      ;;
    turso | --turso)
      DATABASE_MODE="turso"
      shift
      ;;
    pglite | --pglite | pg-lite | --pg-lite | memory | --memory)
      DATABASE_MODE="pglite"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    --)
      shift
      ;;
    -*)
      ;;
    *)
      echo "Unsupported API database mode: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
fi

if [ "$#" -gt 0 ] && [ "$1" = "--" ]; then
  shift
fi

case "$(printf '%s' "$DATABASE_MODE" | tr '[:upper:]' '[:lower:]')" in
  postgres | persistent)
    export API_DATABASE="postgres"
    ;;
  sqlite)
    export API_DATABASE="sqlite"
    ;;
  turso)
    export API_DATABASE="turso"
    ;;
  pglite | pg-lite | memory | "")
    export API_DATABASE="pglite"
    ;;
  *)
    echo "Unsupported API_DATABASE value: $DATABASE_MODE" >&2
    usage >&2
    exit 1
    ;;
esac

cd "$API_DIR"
exec bun run dev ${1+"$@"}
