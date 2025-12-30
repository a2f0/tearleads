#!/bin/sh
#
# Rebuilds better-sqlite3-multiple-ciphers for Node.js (not Electron).
# This is needed for Vitest integration tests which run in Node.js.
#
# The postinstall script runs electron-rebuild which compiles for Electron.
# This script rebuilds for the system Node.js version.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLIENT_DIR="${PROJECT_ROOT}/packages/client"

echo "Rebuilding better-sqlite3-multiple-ciphers for Node.js..."

cd "${CLIENT_DIR}"

# Use npm rebuild to recompile native modules for Node.js
# This overwrites the Electron-compiled version
pnpm rebuild better-sqlite3-multiple-ciphers

echo "Rebuild complete. Native module is now compatible with Node.js."
