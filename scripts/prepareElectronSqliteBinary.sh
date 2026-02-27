#!/bin/sh
set -eu

# Convert shell path to Node.js-compatible path.
# On Windows (Git Bash/MSYS2), pwd returns POSIX paths like /d/a/...
# which Node.js misinterprets as D:\d\a\... (extra "d" segment).
# cygpath -m converts to D:/a/... which Node understands correctly.
to_node_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1"
  else
    printf '%s' "$1"
  fi
}

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLIENT_DIR="$ROOT_DIR/packages/client"
GENERATED_DIR="$CLIENT_DIR/.generated/electron-native"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tearleads-electron-sqlite-build.XXXXXX")"
WORKSPACE_DIR="$WORK_DIR/workspace"
OUTPUT_BINARY="$GENERATED_DIR/better_sqlite3.node"
STAMP_FILE="$GENERATED_DIR/build-stamp.txt"

cleanup() {
  rm -rf "$WORK_DIR"
}

trap cleanup EXIT INT TERM

get_pkg_version() {
  query="$1"
  error_msg="$2"
  # Use to_node_path to convert POSIX paths for Node.js on Windows (see comment above)
  node -e "
const fs = require('node:fs');
const path = require('node:path');
const packageJsonPath = path.resolve('$(to_node_path "$CLIENT_DIR")', 'package.json');
const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const value = $query;
if (typeof value !== 'string' || value.length === 0) {
  throw new Error('$error_msg');
}
process.stdout.write(value);
"
}

ELECTRON_VERSION="$(get_pkg_version "pkg.devDependencies.electron" "Missing devDependencies.electron in packages/client/package.json")"
SQLITE_VERSION="$(get_pkg_version "pkg.dependencies['better-sqlite3-multiple-ciphers']" "Missing dependencies.better-sqlite3-multiple-ciphers in packages/client/package.json")"
REBUILD_VERSION="$(get_pkg_version "pkg.devDependencies['@electron/rebuild']" "Missing devDependencies.@electron/rebuild in packages/client/package.json")"
PLATFORM="$(node -p "process.platform")"
ARCH="$(node -p "process.arch")"
NODE_VERSION="$(node -p "process.version")"

BUILD_STAMP="electron=${ELECTRON_VERSION};sqlite=${SQLITE_VERSION};rebuild=${REBUILD_VERSION};platform=${PLATFORM};arch=${ARCH};node=${NODE_VERSION}"

if [ "${FORCE_ELECTRON_SQLITE_REBUILD:-0}" != "1" ] &&
  [ -f "$OUTPUT_BINARY" ] &&
  [ -f "$STAMP_FILE" ] &&
  [ "$(cat "$STAMP_FILE")" = "$BUILD_STAMP" ]; then
  echo "Electron SQLite native binary is up to date."
  exit 0
fi

echo "Preparing Electron-native better-sqlite3-multiple-ciphers binary..."
rm -rf "$WORKSPACE_DIR"
mkdir -p "$WORKSPACE_DIR"

cat >"$WORKSPACE_DIR/package.json" <<EOF
{
  "name": "tearleads-electron-sqlite-build",
  "private": true,
  "version": "0.0.0",
  "dependencies": {
    "better-sqlite3-multiple-ciphers": "${SQLITE_VERSION}"
  },
  "devDependencies": {
    "@electron/rebuild": "${REBUILD_VERSION}"
  }
}
EOF

(
  cd "$WORKSPACE_DIR"
  pnpm install \
    --ignore-scripts \
    --config.node-linker=isolated \
    --config.package-import-method=copy
  pnpm exec electron-rebuild \
    --force \
    --only better-sqlite3-multiple-ciphers \
    --version "$ELECTRON_VERSION"
)

# Use to_node_path to convert POSIX paths for Node.js on Windows (see comment above)
BUILT_BINARY="$(node -e "
const path = require('node:path');
const pkgPath = require.resolve('better-sqlite3-multiple-ciphers/package.json', {
  paths: ['$(to_node_path "$WORKSPACE_DIR")'],
});
process.stdout.write(
  path.join(path.dirname(pkgPath), 'build', 'Release', 'better_sqlite3.node')
);
")"

if [ ! -f "$BUILT_BINARY" ]; then
  echo "Failed to locate rebuilt binary: $BUILT_BINARY" >&2
  exit 1
fi

mkdir -p "$GENERATED_DIR"
cp "$BUILT_BINARY" "$OUTPUT_BINARY"
chmod 755 "$OUTPUT_BINARY"
printf '%s\n' "$BUILD_STAMP" >"$STAMP_FILE"

echo "Electron SQLite binary ready: $OUTPUT_BINARY"
