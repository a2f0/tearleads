#!/usr/bin/env sh

set -eu

fail() {
  echo "Error: $*" >&2
  exit 1
}

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) ||
  fail "Protocol model checks must run inside a Git repository."
MODEL_PATH=formal/document-sync/BaselineDominance.tla
CONFIG_PATH=formal/document-sync/BaselineDominance.cfg

cd "$REPO_ROOT"

command -v mise >/dev/null 2>&1 ||
  fail "mise is unavailable. Install mise, then run 'mise install github:tlaplus/tlaplus'."

JAVA_ROOT=$(mise where java 2>/dev/null) ||
  fail "Java is unavailable. Run 'mise install java'."
JAVA_BIN=$JAVA_ROOT/bin/java
[ -x "$JAVA_BIN" ] || fail "$JAVA_BIN is not executable."

TLA_TOOLS_ROOT=$(mise where github:tlaplus/tlaplus 2>/dev/null) ||
  fail "TLA+ tools are unavailable. Run 'mise install github:tlaplus/tlaplus'."
TLA_TOOLS_JAR=$TLA_TOOLS_ROOT/tla2tools.jar
[ -f "$TLA_TOOLS_JAR" ] || fail "$TLA_TOOLS_JAR does not exist."
[ -f "$MODEL_PATH" ] || fail "$MODEL_PATH does not exist."
[ -f "$CONFIG_PATH" ] || fail "$CONFIG_PATH does not exist."

MODEL_STATE_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/tearleads-tlc.XXXXXX")
trap 'rm -rf "$MODEL_STATE_ROOT"' EXIT
trap 'exit 1' HUP INT TERM

"$JAVA_BIN" -XX:+UseParallelGC -jar "$TLA_TOOLS_JAR" \
  -workers 1 \
  -metadir "$MODEL_STATE_ROOT" \
  -config "$CONFIG_PATH" \
  "$MODEL_PATH"
