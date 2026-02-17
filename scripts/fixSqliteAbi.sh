#!/bin/sh
#
# Rebuilds better-sqlite3-multiple-ciphers against the current Node ABI.
# This fixes errors such as:
# "was compiled against a different Node.js version using NODE_MODULE_VERSION X"
#
# Usage:
#   ./scripts/fixSqliteAbi.sh
#   ./scripts/fixSqliteAbi.sh --test   # also run @tearleads/cli tests
#

set -eu

SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)
PROJECT_ROOT=$(cd "${SCRIPT_DIR}/.." && pwd)

echo "Node version: $(node -v)"
echo "Node ABI: $(node -p "process.versions.modules")"

echo "Locating better-sqlite3-multiple-ciphers..."
MODULE_PKG_PATH=$(
  cd "${PROJECT_ROOT}/packages/cli" &&
    node -e "console.log(require.resolve('better-sqlite3-multiple-ciphers/package.json'))"
)
MODULE_DIR=$(dirname "${MODULE_PKG_PATH}")

echo "Module path: ${MODULE_DIR}"
echo "Removing previous native build artifacts..."
rm -rf "${MODULE_DIR}/build"

echo "Rebuilding better-sqlite3-multiple-ciphers from source..."
(
  cd "${MODULE_DIR}" &&
    npm_config_build_from_source=true pnpm run install
)

echo "Verifying native module can load..."
(
  cd "${PROJECT_ROOT}/packages/cli" &&
    node -e "const Database=require('better-sqlite3-multiple-ciphers');const db=new Database(':memory:');db.exec('select 1');db.close();console.log('Native module load check passed');"
)

if [ "${1:-}" = "--test" ]; then
  echo "Running @tearleads/cli tests..."
  cd "${PROJECT_ROOT}"
  pnpm --filter @tearleads/cli test
fi

echo "SQLite native ABI fix complete."
