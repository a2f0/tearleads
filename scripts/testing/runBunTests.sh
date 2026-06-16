#!/bin/sh
set -e

force=""
# Rebuild the positional parameters, pulling out --force. --force is a turbo
# flag (bypass its cache), so it must be passed to turbo before the -- separator
# rather than forwarded to the underlying test runner. Rebuilding "$@" instead
# of accumulating a string preserves arguments that contain spaces.
n=$#
while [ "$n" -gt 0 ]; do
  arg=$1
  shift
  n=$((n - 1))
  if [ "$arg" = "--force" ]; then
    force="--force"
  else
    set -- "$@" "$arg"
  fi
done

if [ -n "$force" ]; then
  bun run test:turbo:bun "$force" -- "$@"
else
  bun run test:turbo:bun -- "$@"
fi
