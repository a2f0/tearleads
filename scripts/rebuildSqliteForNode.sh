#!/bin/sh
#
# Rebuilds better-sqlite3-multiple-ciphers for Node.js and stores it separately.
#
# The postinstall script runs electron-rebuild which compiles for Electron.
# This script creates a separate Node.js-compatible binary for vitest tests
# while preserving the Electron binary for dev mode.
#
# The Node.js binary is stored in packages/client/native/node/ and loaded
# via the nativeBinding option in NodeAdapter.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLIENT_DIR="${PROJECT_ROOT}/packages/client"
NATIVE_NODE_DIR="${CLIENT_DIR}/native/node"

# Path to the native module in node_modules
SQLITE_MODULE_DIR="${PROJECT_ROOT}/node_modules/.pnpm/better-sqlite3-multiple-ciphers@12.5.0/node_modules/better-sqlite3-multiple-ciphers"
NATIVE_MODULE="${SQLITE_MODULE_DIR}/build/Release/better_sqlite3.node"

# Create the native/node directory if it doesn't exist
mkdir -p "${NATIVE_NODE_DIR}"

# Check if we already have a Node.js-compiled binary that matches the current Node version
NODE_VERSION=$(node --version)
VERSION_FILE="${NATIVE_NODE_DIR}/.node-version"

if [ -f "${VERSION_FILE}" ] && [ -f "${NATIVE_NODE_DIR}/better_sqlite3.node" ]; then
  CACHED_VERSION=$(cat "${VERSION_FILE}")
  if [ "${CACHED_VERSION}" = "${NODE_VERSION}" ]; then
    echo "Node.js native module already compiled for ${NODE_VERSION}, skipping rebuild."
    exit 0
  fi
fi

echo "Building better-sqlite3-multiple-ciphers for Node.js ${NODE_VERSION}..."

# Back up the current (Electron) binary if it exists
BACKUP_FILE="${SQLITE_MODULE_DIR}/build/Release/better_sqlite3.node.electron-backup"
if [ -f "${NATIVE_MODULE}" ]; then
  echo "Backing up Electron binary..."
  cp "${NATIVE_MODULE}" "${BACKUP_FILE}"
fi

# Rebuild for Node.js
cd "${CLIENT_DIR}"
pnpm rebuild better-sqlite3-multiple-ciphers

# Copy the Node.js binary to our native directory
echo "Copying Node.js binary to ${NATIVE_NODE_DIR}..."
cp "${NATIVE_MODULE}" "${NATIVE_NODE_DIR}/better_sqlite3.node"
echo "${NODE_VERSION}" > "${VERSION_FILE}"

# Restore the Electron binary if we backed it up
if [ -f "${BACKUP_FILE}" ]; then
  echo "Restoring Electron binary..."
  cp "${BACKUP_FILE}" "${NATIVE_MODULE}"
  rm "${BACKUP_FILE}"
fi

echo "Done! Node.js binary stored at: ${NATIVE_NODE_DIR}/better_sqlite3.node"
echo "Electron binary preserved at: ${NATIVE_MODULE}"
