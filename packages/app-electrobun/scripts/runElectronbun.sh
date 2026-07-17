#!/bin/sh
set -e

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
PACKAGE_DIR="$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(CDPATH='' cd -- "$PACKAGE_DIR/../.." && pwd)"

# Identity of the dev app's persisted webview data. Electrobun stores OPFS,
# IndexedDB, and localStorage under <appDataDir>/<identifier>/<channel> (see
# electrobun's core/Utils.ts paths.userData); the dev run uses the "dev"
# channel. Read both from the built version.json when present so this tracks
# electrobun's own derivation, falling back to the config defaults otherwise.
APP_IDENTIFIER="com.tearleads.app"
APP_CHANNEL="dev"
# The build dir is dev-<platform>-<arch> and the bundle layout differs by OS
# (Linux: <name>/Resources/...; macOS: <name>.app/Contents/Resources/...), so
# glob across both rather than hardcoding one platform.
VERSION_JSON=""
for candidate in \
  "$PACKAGE_DIR"/build/dev-*/Tearleads-dev/Resources/version.json \
  "$PACKAGE_DIR"/build/dev-*/Tearleads-dev.app/Contents/Resources/version.json; do
  if [ -f "$candidate" ]; then
    VERSION_JSON="$candidate"
    break
  fi
done
if [ -n "$VERSION_JSON" ]; then
  # Parse with bun (this is a Bun project) rather than sed, which is fragile on
  # JSON. A read failure leaves the field empty and the default stands.
  PARSED_IDENTIFIER="$(
    VERSION_JSON_PATH="$VERSION_JSON" bun -e \
      'try { process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.env.VERSION_JSON_PATH, "utf8")).identifier ?? "")) } catch {}'
  )"
  PARSED_CHANNEL="$(
    VERSION_JSON_PATH="$VERSION_JSON" bun -e \
      'try { process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.env.VERSION_JSON_PATH, "utf8")).channel ?? "")) } catch {}'
  )"
  [ -n "$PARSED_IDENTIFIER" ] && APP_IDENTIFIER="$PARSED_IDENTIFIER"
  [ -n "$PARSED_CHANNEL" ] && APP_CHANNEL="$PARSED_CHANNEL"
fi

usage() {
  cat >&2 <<EOF
Usage: $0 [dev|dev:watch|build|build:dev] [--reset] [electrobun args...]

  --reset  Wipe the dev app's persisted webview data (OPFS, IndexedDB,
           localStorage) before launching, for a clean-bootstrap run.
EOF
}

# Per-OS roots, matching electrobun's getAppDataDir()/getCacheDir() so the wipe
# targets the same dirs the running app actually uses.
app_data_dir() {
  case "$(uname -s)" in
    Darwin) printf '%s\n' "$HOME/Library/Application Support" ;;
    *) printf '%s\n' "${XDG_DATA_HOME:-$HOME/.local/share}" ;;
  esac
}

cache_dir() {
  case "$(uname -s)" in
    Darwin) printf '%s\n' "$HOME/Library/Caches" ;;
    *) printf '%s\n' "${XDG_CACHE_HOME:-$HOME/.cache}" ;;
  esac
}

reset_app_data() {
  # Guard against an empty identifier/channel: without this an empty segment
  # would collapse the target to the base app-support/cache dir and rm -rf it.
  if [ -z "$APP_IDENTIFIER" ] || [ -z "$APP_CHANNEL" ]; then
    echo "Error: empty app identifier/channel; aborting reset to avoid deleting the base data dir." >&2
    exit 1
  fi
  user_data="$(app_data_dir)/$APP_IDENTIFIER/$APP_CHANNEL"
  user_cache="$(cache_dir)/$APP_IDENTIFIER/$APP_CHANNEL"
  echo "Resetting dev app data (OPFS, IndexedDB, localStorage):"
  for target in "$user_data" "$user_cache"; do
    if [ -e "$target" ]; then
      echo "  removing $target"
      rm -rf "$target"
    else
      echo "  (absent) $target"
    fi
  done
}

build_workspace_deps() {
  (cd "$REPO_ROOT" && bunx turbo run build --filter=app-electrobun^...)
}

# Pull a position-independent --reset out of the args before the command parse,
# so `dev --reset` and `--reset dev` both work and the flag is never forwarded
# to electrobun. Filter the positional params in place so quoting/word-splitting
# of the remaining args (e.g. ones containing spaces) is preserved.
RESET=0
for arg in "$@"; do
  shift
  if [ "$arg" = "--reset" ]; then
    RESET=1
    continue
  fi
  set -- "$@" "$arg"
done

if [ "$#" -eq 0 ]; then
  set -- dev
fi

COMMAND="$1"
shift

case "$COMMAND" in
  dev)
    ELECTROBUN_COMMAND="dev"
    ;;
  dev:watch)
    ELECTROBUN_COMMAND="dev"
    set -- --watch "$@"
    ;;
  build)
    build_workspace_deps
    exec "$SCRIPT_DIR/buildElectrobun.sh" "$@"
    ;;
  build:dev)
    build_workspace_deps
    exec "$SCRIPT_DIR/buildElectrobun.sh" --env dev "$@"
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage
    exit 2
    ;;
esac

if [ "$RESET" -eq 1 ]; then
  reset_app_data
fi

build_workspace_deps

cd "$PACKAGE_DIR"
export TEARLEADS_ELECTROBUN_PACKAGE_DIR="$PACKAGE_DIR"
exec sh "$REPO_ROOT/scripts/withBuildInfoEnv.sh" \
  bun run electrobun "$ELECTROBUN_COMMAND" "$@"
