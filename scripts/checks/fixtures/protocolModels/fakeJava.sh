#!/usr/bin/env sh

set -eu

: "${FAKE_JAVA_LOG:?}"

model_path=
config_path=
metadir_path=

while [ "$#" -gt 0 ]; do
  case "$1" in
    -config)
      shift
      config_path=${1:-}
      ;;
    -metadir)
      shift
      metadir_path=${1:-}
      ;;
    *.tla) model_path=$1 ;;
  esac
  shift
done

[ -n "$model_path" ] || exit 2
[ -n "$config_path" ] || exit 2
[ -n "$metadir_path" ] || exit 2

printf '%s|%s|%s\n' "$model_path" "$config_path" "$metadir_path" >>"$FAKE_JAVA_LOG"

if [ "${FAKE_FAIL_CONFIG:-}" = "$config_path" ] ||
  [ "${FAKE_FAIL_MODEL:-}" = "$model_path" ]; then
  exit "${FAKE_FAIL_STATUS:-1}"
fi
