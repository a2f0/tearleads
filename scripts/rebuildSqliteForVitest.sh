#!/bin/sh
set -eu

# Rebuild better-sqlite3-multiple-ciphers for Node.js (vitest)
# This is needed after electron-rebuild has compiled the module for Electron's ABI

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

NODE_GYP_REL=$(find "$ROOT_DIR/node_modules/.pnpm" -path '*/node-gyp/bin/node-gyp.js' -print -quit 2>/dev/null || true)
SQLITE_MODULE_REL=$(find "$ROOT_DIR/node_modules/.pnpm" -path '*/better-sqlite3-multiple-ciphers' -print -quit 2>/dev/null || true)

if [ -z "$NODE_GYP_REL" ]; then
  echo "Failed to locate node-gyp"
  exit 1
fi

if [ -z "$SQLITE_MODULE_REL" ]; then
  echo "Failed to locate better-sqlite3-multiple-ciphers"
  exit 1
fi

echo "Rebuilding better-sqlite3-multiple-ciphers for Node.js..."
(cd "$SQLITE_MODULE_REL" && node "$NODE_GYP_REL" rebuild --release)
echo "Done."
