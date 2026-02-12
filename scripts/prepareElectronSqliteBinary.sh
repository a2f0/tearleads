#!/bin/sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLIENT_DIR="$ROOT_DIR/packages/client"
GENERATED_DIR="$CLIENT_DIR/.generated/electron-native"
WORK_DIR="${TMPDIR:-/tmp}/tearleads-electron-sqlite-build"
WORKSPACE_DIR="$WORK_DIR/workspace"
OUTPUT_BINARY="$GENERATED_DIR/better_sqlite3.node"
STAMP_FILE="$GENERATED_DIR/build-stamp.txt"

ELECTRON_VERSION="$(node -e "
const fs = require('node:fs');
const path = require('node:path');
const packageJsonPath = path.resolve('$CLIENT_DIR', 'package.json');
const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const value = pkg.devDependencies.electron;
if (typeof value !== 'string' || value.length === 0) {
  throw new Error('Missing devDependencies.electron in packages/client/package.json');
}
process.stdout.write(value);
")"

SQLITE_VERSION="$(node -e "
const fs = require('node:fs');
const path = require('node:path');
const packageJsonPath = path.resolve('$CLIENT_DIR', 'package.json');
const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const value = pkg.dependencies['better-sqlite3-multiple-ciphers'];
if (typeof value !== 'string' || value.length === 0) {
  throw new Error('Missing dependencies.better-sqlite3-multiple-ciphers in packages/client/package.json');
}
process.stdout.write(value);
")"

REBUILD_VERSION="$(node -e "
const fs = require('node:fs');
const path = require('node:path');
const packageJsonPath = path.resolve('$CLIENT_DIR', 'package.json');
const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const value = pkg.devDependencies['@electron/rebuild'];
if (typeof value !== 'string' || value.length === 0) {
  throw new Error('Missing devDependencies.@electron/rebuild in packages/client/package.json');
}
process.stdout.write(value);
")"
PLATFORM="$(node -p "process.platform")"
ARCH="$(node -p "process.arch")"

BUILD_STAMP="electron=${ELECTRON_VERSION};sqlite=${SQLITE_VERSION};rebuild=${REBUILD_VERSION};platform=${PLATFORM};arch=${ARCH}"

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

BUILT_BINARY="$(node -e "
const path = require('node:path');
const pkgPath = require.resolve('better-sqlite3-multiple-ciphers/package.json', {
  paths: ['$WORKSPACE_DIR'],
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
