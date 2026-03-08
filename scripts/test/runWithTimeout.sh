#!/usr/bin/env sh
set -eu

timeout_seconds=120
if [ "${1:-}" = "--seconds" ]; then
  if [ -z "${2:-}" ]; then
    echo "runWithTimeout: missing value for --seconds" >&2
    exit 2
  fi
  timeout_seconds=$2
  shift 2
fi

if [ "${1:-}" = "--" ]; then
  shift
fi

if [ "$#" -eq 0 ]; then
  echo "runWithTimeout: expected a command to execute" >&2
  exit 2
fi

"$@" &
command_pid=$!

(
  sleep "$timeout_seconds"
  if kill -0 "$command_pid" 2>/dev/null; then
    echo "runWithTimeout: command exceeded ${timeout_seconds}s and will be terminated" >&2
    kill -TERM "$command_pid" 2>/dev/null || true
    sleep 5
    kill -KILL "$command_pid" 2>/dev/null || true
  fi
) &
watchdog_pid=$!

set +e
wait "$command_pid"
command_status=$?
set -e

kill "$watchdog_pid" 2>/dev/null || true
wait "$watchdog_pid" 2>/dev/null || true

exit "$command_status"
