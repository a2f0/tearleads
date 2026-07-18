#!/usr/bin/env sh

set -eu

case "${1:-}:${2:-}" in
  which:java) printf '%s\n' "$FAKE_JAVA" ;;
  where:github:tlaplus/tlaplus) printf '%s\n' "$FAKE_TLA_TOOLS_ROOT" ;;
  *) exit 2 ;;
esac
