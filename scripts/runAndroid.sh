#!/bin/sh
set -e

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR/../packages/app-capacitor"

# The Gradle wrapper jar is binary, so it is gitignored rather than committed.
# Regenerate it from the mise-pinned Gradle when missing. The version comes from
# the active gradle (see .mise.toml); --distribution-type all keeps the jar and
# gradle-wrapper.properties consistent with what is checked in.
WRAPPER_JAR="android/gradle/wrapper/gradle-wrapper.jar"
if [ ! -f "$WRAPPER_JAR" ]; then
  echo "Generating $WRAPPER_JAR from mise-pinned Gradle..."
  gradle -p android wrapper --distribution-type all
fi

bun run build
bun run cap:sync
bun run cap:run:android
