#!/bin/sh
# Update everything in the repo. Run from anywhere.
#
# Optional environment toggles:
#   SKIP_RUBY=1       Skip bundle update/install
#   SKIP_CAP_SYNC=1   Skip pnpm cap:sync
#   SKIP_POD_CLEAN=1  Skip clean pod install (removes Pods/ and Podfile.lock)
#   SKIP_MAESTRO=1    Skip Maestro tests
#   SKIP_TESTS=1      Skip pnpm test
#   SKIP_BUILD=1      Skip pnpm build
#   SKIP_LINT=1       Skip pnpm lint:fix + pnpm lint
#   SKIP_UPDATE=1     Skip pnpm -r update --latest
#   SKIP_INSTALL=1    Skip pnpm install
set -eu

SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd -P)

cd "$REPO_ROOT"

if [ -n "$(git status --porcelain)" ]; then
  echo "Warning: working tree is not clean. Continuing anyway." >&2
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

if [ "${SKIP_RUBY:-0}" -ne 1 ]; then
  (cd packages/client && bundle update)
  (cd packages/client && bundle install)
fi

if [ "${SKIP_CAP_SYNC:-0}" -ne 1 ]; then
  pnpm --filter @tearleads/client cap:sync
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
  "$SCRIPT_DIR/runMaestroIosTests.sh" --headless
  "$SCRIPT_DIR/runMaestroAndroidTests.sh" --headless
fi

echo "Update-everything script completed. Review warnings/deprecations from command output." >&2
