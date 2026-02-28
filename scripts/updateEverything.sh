#!/bin/sh
# Update everything in the repo. Run from anywhere.
#
# Optional environment toggles:
#   SKIP_BRANCH_GUARD=1   Allow running on main/master
#   SKIP_TOOLCHAIN_SYNC=1   Skip toolchain sync (Node/Electron + Android SDK)
#   SKIP_TOOLCHAIN_NODE=1   Skip Node/Electron sync inside toolchain sync
#   SKIP_TOOLCHAIN_ANDROID=1 Skip Android SDK sync inside toolchain sync
#   TOOLCHAIN_SYNC_MAX_ANDROID_JUMP=<n> Max Android API bump in one run (default: 1)
#   TOOLCHAIN_SYNC_ALLOW_RUNTIME_MISMATCH=1 Continue even if active Node != .nvmrc
#   Node runtime is always managed with mise; script exits if mise is unavailable
#   SKIP_RUBY=1       Skip bundle update/install
#   SKIP_CAP_SYNC=1   Skip pnpm cap:sync
#   SKIP_POD_CLEAN=1  Skip clean pod install (removes Pods/ and Podfile.lock)
#   SKIP_MAESTRO=1    Skip Maestro tests
#   SKIP_TESTS=1      Skip pnpm test
#   SKIP_BUILD=1      Skip pnpm build
#   SKIP_LINT=1       Skip pnpm lint:fix + pnpm lint
#   SKIP_UPDATE=1     Skip pnpm -r update --latest
#   SKIP_INSTALL=1    Skip pnpm install
#   UPGRADE_CODEX=1   Opt in to brew upgrade codex on macOS
set -eu

SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd -P)
WARNINGS_SUMMARY=""

warn() {
  echo "Warning: $*" >&2
}

append_warning() {
  WARNINGS_SUMMARY="${WARNINGS_SUMMARY}$1
"
}

require_command() {
  CMD_NAME="$1"
  HELP_TEXT="$2"
  if ! command -v "$CMD_NAME" >/dev/null 2>&1; then
    echo "updateEverything: required command '$CMD_NAME' not found. $HELP_TEXT" >&2
    exit 1
  fi
}

ensure_mise_node_runtime() {
  if ! command -v mise >/dev/null 2>&1; then
    echo "updateEverything: mise is required and must be available on PATH." >&2
    echo "Install mise (https://mise.jdx.dev) and rerun. Homebrew Node management is not supported in this flow." >&2
    exit 1
  fi

  if ! mise install node; then
    echo "updateEverything: failed to install Node from .nvmrc via mise." >&2
    exit 1
  fi
}

cd "$REPO_ROOT"

require_command git "Install git and rerun."
require_command jq "Install jq and rerun."
require_command pnpm "Install pnpm and rerun."

if [ "${SKIP_BRANCH_GUARD:-0}" -ne 1 ]; then
  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
  if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
    echo "updateEverything: refusing to run on '$CURRENT_BRANCH'. Switch to a feature branch or set SKIP_BRANCH_GUARD=1." >&2
    exit 1
  fi
fi

if [ -n "$(git status --porcelain)" ]; then
  warn "working tree is not clean. Continuing anyway."
fi

# Keep Codex CLI current on macOS hosts when explicitly requested.
if [ "${UPGRADE_CODEX:-0}" -eq 1 ] && [ "$(uname -s)" = "Darwin" ]; then
  if command -v brew >/dev/null 2>&1; then
    brew upgrade codex || warn "Failed to upgrade codex CLI."
  else
    warn "Homebrew not found; skipping codex upgrade."
    append_warning "codex-upgrade: skipped (brew missing)"
  fi
fi

ensure_mise_node_runtime

if [ "${SKIP_TOOLCHAIN_SYNC:-0}" -ne 1 ]; then
  require_command curl "Install curl or set SKIP_TOOLCHAIN_SYNC=1."
  TOOLCHAIN_ARGS="--apply --max-android-jump ${TOOLCHAIN_SYNC_MAX_ANDROID_JUMP:-1}"
  if [ "${SKIP_TOOLCHAIN_NODE:-0}" -eq 1 ]; then
    TOOLCHAIN_ARGS="$TOOLCHAIN_ARGS --skip-node"
  fi
  if [ "${SKIP_TOOLCHAIN_ANDROID:-0}" -eq 1 ]; then
    TOOLCHAIN_ARGS="$TOOLCHAIN_ARGS --skip-android"
  fi
  # shellcheck disable=SC2086
  MAX_ANDROID_API_JUMP="${TOOLCHAIN_SYNC_MAX_ANDROID_JUMP:-1}" \
  TOOLCHAIN_SYNC_ALLOW_RUNTIME_MISMATCH="${TOOLCHAIN_SYNC_ALLOW_RUNTIME_MISMATCH:-0}" \
    "$SCRIPT_DIR/syncToolchainVersions.sh" $TOOLCHAIN_ARGS
fi

if [ "${SKIP_UPDATE:-0}" -ne 1 ]; then
  pnpm -r update --latest
fi

if [ "${SKIP_INSTALL:-0}" -ne 1 ]; then
  pnpm install
fi

# Check for unpinned dependencies (carets/tildes) in dependencies and devDependencies only.
# peerDependencies are allowed to have ranges.
PINNED_MATCHES=""
for pkg in package.json packages/*/package.json; do
  [ -f "$pkg" ] || continue
  DEPS=$(jq -r '(.dependencies // {}) + (.devDependencies // {}) | to_entries[] | select(.value | test("^[\\^~]")) | "\(.key): \(.value)"' "$pkg" 2>/dev/null || true)
  if [ -n "$DEPS" ]; then
    PINNED_MATCHES="${PINNED_MATCHES}${pkg}:
${DEPS}
"
  fi
done
if [ -n "$PINNED_MATCHES" ]; then
  echo "Unpinned dependencies detected (caret/tilde). Please pin them:" >&2
  echo "$PINNED_MATCHES" >&2
  exit 1
fi

# Check for peerDependency version mismatches in workspace packages.
# Only checks PINNED peerDependencies (no ^/~ ranges) against client versions.
# Pinned peer versions must match the client to prevent "useContext is null" errors.
# Packages can use ranges (^/~) for flexibility - those are allowed to differ.
CLIENT_PKG="packages/client/package.json"
PEER_MISMATCHES=""
for pkg in packages/*/package.json; do
  [ -f "$pkg" ] || continue
  [ "$pkg" = "$CLIENT_PKG" ] && continue

  # Get PINNED peerDependencies (no ^/~ and not workspace:*) that are in client's deps
  # Use process substitution to avoid subshell variable scope issues with while read
  while IFS= read -r peer || [ -n "$peer" ]; do
    [ -z "$peer" ] && continue
    DEP_NAME="${peer%%=*}"
    PEER_VER="${peer#*=}"

    # Check client's dependencies and devDependencies for the actual version
    CLIENT_VER=$(jq -r --arg dep "$DEP_NAME" '(.dependencies[$dep] // .devDependencies[$dep]) // empty' "$CLIENT_PKG" 2>/dev/null || true)

    # If client has this dependency and versions don't match, flag it
    if [ -n "$CLIENT_VER" ] && [ "$PEER_VER" != "$CLIENT_VER" ]; then
      PEER_MISMATCHES="${PEER_MISMATCHES}${pkg}: ${DEP_NAME} (peer: ${PEER_VER}, client: ${CLIENT_VER})
"
    fi
  done <<EOF
$(jq -r '.peerDependencies // {} | to_entries[] | select(.value | test("^[\\^~]|^workspace:") | not) | "\(.key)=\(.value)"' "$pkg" 2>/dev/null || true)
EOF
done
if [ -n "$PEER_MISMATCHES" ]; then
  echo "peerDependency version mismatches detected. Update peerDependencies to match client:" >&2
  echo "$PEER_MISMATCHES" >&2
  exit 1
fi

if [ "${SKIP_LINT:-0}" -ne 1 ]; then
  pnpm lint:fix
  pnpm lint
fi

if [ "${SKIP_BUILD:-0}" -ne 1 ]; then
  pnpm build
fi

if [ "${SKIP_TESTS:-0}" -ne 1 ]; then
  pnpm test
fi

if [ "${SKIP_RUBY:-0}" -ne 1 ] && ! command -v bundle >/dev/null 2>&1; then
  warn "bundle not found; skipping Ruby dependency updates."
  append_warning "ruby: skipped (bundle missing)"
  SKIP_RUBY=1
fi

if [ "${SKIP_RUBY:-0}" -ne 1 ]; then
  (cd packages/client && bundle update)
  (cd packages/client && bundle install)
fi

if [ "${SKIP_CAP_SYNC:-0}" -ne 1 ]; then
  pnpm --filter @tearleads/client cap:sync
fi

if [ "${SKIP_POD_CLEAN:-0}" -ne 1 ] && ! command -v pod >/dev/null 2>&1; then
  warn "pod not found; skipping clean pod install."
  append_warning "pod-clean: skipped (pod missing)"
  SKIP_POD_CLEAN=1
fi

# Clean pod install to ensure fresh CocoaPods dependencies.
# This prevents stale xcframework caches from causing build failures
# when native libraries (like IONFilesystemLib) are updated.
if [ "${SKIP_POD_CLEAN:-0}" -ne 1 ]; then
  (
    cd packages/client/ios/App
    rm -rf Pods Podfile.lock
    pod install --repo-update
  )
fi

# Ensure Capacitor JS dependency versions stay aligned with iOS native resolution.
POD_LOCK="packages/client/ios/App/Podfile.lock"
CAPACITOR_MISMATCHES=""
if [ -f "$CLIENT_PKG" ] && [ -f "$POD_LOCK" ]; then
  while IFS= read -r dep || [ -n "$dep" ]; do
    [ -z "$dep" ] && continue
    DEP_NAME="${dep%%=*}"
    DEP_VER="${dep#*=}"
    CAP_PACKAGE="${DEP_NAME#@capacitor/}"
    LOCK_TOKEN="@capacitor+${CAP_PACKAGE}@"

    # Skip packages not represented in Podfile.lock for this project.
    if ! grep -Fq "$LOCK_TOKEN" "$POD_LOCK"; then
      continue
    fi

    LOCK_VER=$(grep -oE "@capacitor\\+${CAP_PACKAGE}@[0-9A-Za-z.+-]+" "$POD_LOCK" | head -n 1 | sed "s/^@capacitor+${CAP_PACKAGE}@//")
    if [ -n "$LOCK_VER" ] && [ "$LOCK_VER" != "$DEP_VER" ]; then
      CAPACITOR_MISMATCHES="${CAPACITOR_MISMATCHES}${DEP_NAME}: package.json=${DEP_VER}, Podfile.lock=${LOCK_VER}
"
    fi
  done <<EOF
$(jq -r '((.dependencies // {}) + (.devDependencies // {})) | to_entries[] | select(.key | startswith("@capacitor/")) | select(.value | startswith("workspace:") | not) | "\(.key)=\(.value)"' "$CLIENT_PKG" 2>/dev/null || true)
EOF
fi
if [ -n "$CAPACITOR_MISMATCHES" ]; then
  echo "Capacitor dependency mismatches detected between package.json and Podfile.lock:" >&2
  echo "$CAPACITOR_MISMATCHES" >&2
  echo "Update packages/client/package.json and regenerate iOS dependencies (cap:sync / pod install)." >&2
  exit 1
fi

if [ "${SKIP_MAESTRO:-0}" -ne 1 ]; then
  MAESTRO_MISSING=""
  for CMD_NAME in bundle adb emulator xcrun; do
    if ! command -v "$CMD_NAME" >/dev/null 2>&1; then
      MAESTRO_MISSING="${MAESTRO_MISSING} $CMD_NAME"
    fi
  done
  if [ -n "$MAESTRO_MISSING" ]; then
    warn "missing Maestro prerequisites:${MAESTRO_MISSING# }. Skipping Maestro tests."
    append_warning "maestro: skipped (missing:${MAESTRO_MISSING# })"
    SKIP_MAESTRO=1
  fi
fi

if [ "${SKIP_MAESTRO:-0}" -ne 1 ]; then
  "$SCRIPT_DIR/runMaestroIosTests.sh" --headless
  "$SCRIPT_DIR/runMaestroAndroidTests.sh" --headless
fi

if [ -n "$WARNINGS_SUMMARY" ]; then
  echo "Update-everything completed with warnings/skips:" >&2
  echo "$WARNINGS_SUMMARY" >&2
else
  echo "Update-everything script completed. Review warnings/deprecations from command output." >&2
fi
