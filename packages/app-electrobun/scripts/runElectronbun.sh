#!/bin/sh
set -e

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
PACKAGE_DIR="$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd)"

usage() {
  cat >&2 <<EOF
Usage: $0 [dev|dev:watch|build|build:dev] [electrobun args...]
EOF
}

if [ "$#" -eq 0 ]; then
  set -- dev
fi

COMMAND="$1"
shift

case "$COMMAND" in
  dev)
    ELECTROBUN_COMMAND="dev"
    ;;
  dev:watch)
    ELECTROBUN_COMMAND="dev"
    set -- --watch "$@"
    ;;
  build)
    exec "$SCRIPT_DIR/buildElectrobun.sh" "$@"
    ;;
  build:dev)
    exec "$SCRIPT_DIR/buildElectrobun.sh" --env dev "$@"
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage
    exit 2
    ;;
esac

cd "$PACKAGE_DIR"
export TEARLEADS_ELECTROBUN_PACKAGE_DIR="$PACKAGE_DIR"
exec bun run electrobun "$ELECTROBUN_COMMAND" "$@"
