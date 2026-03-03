#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname "$0")" && pwd)"
CLIENT_DIR="$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd)"
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tearleads-electron-pack.XXXXXX")"
ELECTRON_VERSION="$(
  node -e "const fs = require('node:fs'); const p = '$CLIENT_DIR/package.json'; const pkg = JSON.parse(fs.readFileSync(p, 'utf8')); process.stdout.write(pkg.devDependencies?.electron ?? '');"
)"

cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT INT TERM

if [ ! -d "$CLIENT_DIR/out" ]; then
  echo "Missing Electron build output at $CLIENT_DIR/out. Run pnpm electron:build first." >&2
  exit 1
fi

if [ -z "$ELECTRON_VERSION" ]; then
  echo "Unable to determine Electron version from $CLIENT_DIR/package.json." >&2
  exit 1
fi

if [ ! -d "$CLIENT_DIR/.generated/electron-native" ]; then
  echo "Missing generated Electron sqlite native files at $CLIENT_DIR/.generated/electron-native." >&2
  exit 1
fi

mkdir -p "$STAGING_DIR/electron" "$STAGING_DIR/build" "$STAGING_DIR/.generated"

cp "$CLIENT_DIR/package.json" "$STAGING_DIR/package.json"
cp "$CLIENT_DIR/electron-builder.config.ts" "$STAGING_DIR/electron-builder.config.ts"
cp "$CLIENT_DIR/electron/desktopAppId.ts" "$STAGING_DIR/electron/desktopAppId.ts"
cp -R "$CLIENT_DIR/out" "$STAGING_DIR/out"
cp -R "$CLIENT_DIR/.generated/electron-native" "$STAGING_DIR/.generated/electron-native"

if [ -d "$CLIENT_DIR/build/icons" ]; then
  cp -R "$CLIENT_DIR/build/icons" "$STAGING_DIR/build/icons"
fi

node - "$STAGING_DIR/package.json" <<'NODE'
const fs = require('node:fs');

const packageJsonPath = process.argv[2];
if (!packageJsonPath) {
  throw new Error('Expected package.json path argument.');
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const sqliteVersion =
  packageJson.dependencies?.['better-sqlite3-multiple-ciphers'];

if (typeof sqliteVersion !== 'string') {
  throw new Error(
    'Expected better-sqlite3-multiple-ciphers in client dependencies.'
  );
}

packageJson.dependencies = {
  'better-sqlite3-multiple-ciphers': sqliteVersion,
};
packageJson.devDependencies = {};

fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
NODE

(
  cd "$STAGING_DIR"
  pnpm install --prod --ignore-scripts --no-frozen-lockfile
)

node - "$STAGING_DIR/package.json" <<'NODE'
const fs = require('node:fs');

const packageJsonPath = process.argv[2];
if (!packageJsonPath) {
  throw new Error('Expected package.json path argument.');
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
packageJson.packageManager = 'traversal@1.0.0';
fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
NODE

# CI can sit for 30+ minutes in electron-builder's pnpm dependency collector on workspace links.
# Building from a minimal runtime manifest and forcing traversal avoids that unbounded scan.
npm_config_user_agent=traversal \
  npm_execpath=traversal \
  ELECTRON_BUILDER_DISABLE_UPDATES=true \
  "$CLIENT_DIR/node_modules/.bin/electron-builder" \
  --projectDir "$STAGING_DIR" \
  --config electron-builder.config.ts \
  --config.electronVersion "$ELECTRON_VERSION" \
  "$@"

if [ ! -d "$STAGING_DIR/dist-electron" ]; then
  echo "Electron builder did not produce dist-electron in staging directory." >&2
  exit 1
fi

rm -rf "$CLIENT_DIR/dist-electron"
mkdir -p "$CLIENT_DIR/dist-electron"
cp -R "$STAGING_DIR/dist-electron/." "$CLIENT_DIR/dist-electron/"
