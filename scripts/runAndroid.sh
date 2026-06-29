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

# Vite inlines VITE_* at build time; src/index.tsx throws "VITE_API_BASE_URL is
# not set" on boot when it is missing, leaving a blank WebView. From the Android
# emulator the host machine is 10.0.2.2 (not localhost, which is the emulator
# itself); the local API (scripts/runApi.sh) listens on 3001. Override for a
# physical device (use the host's LAN IP) or a non-default API URL/port.
export VITE_API_BASE_URL="${VITE_API_BASE_URL:-http://10.0.2.2:3001}"
echo "Building with VITE_API_BASE_URL=$VITE_API_BASE_URL"

bun run build
bun run cap:sync
bun run cap:run:android
