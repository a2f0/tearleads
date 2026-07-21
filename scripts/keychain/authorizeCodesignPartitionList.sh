#!/bin/sh
set -eu

usage() {
  cat <<EOF
Usage: $(basename "$0")

Grant codesign non-interactive access to the private keys in the login
keychain, so an iOS release archive can be signed from an automated shell
without a GUI "codesign wants to use your key" prompt.

Run this in your own Terminal (a real GUI login session), NOT from an
automated/sandboxed shell. You are prompted for your macOS login password
(input hidden); it is passed to \`security set-key-partition-list\`, which also
unlocks the keychain, so running this alone is enough.

Run unlockLoginKeychain.sh first if you only want to unlock without changing
the partition list.
EOF
}

case "${1:-}" in
  -h | --help)
    usage
    exit 0
    ;;
esac

# Resolve the login keychain rather than hard-coding a per-user path.
resolve_login_keychain() {
  security login-keychain \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//'
}

LOGIN_KEYCHAIN="$(resolve_login_keychain)"
if [ -z "$LOGIN_KEYCHAIN" ]; then
  echo "Error: could not determine the login keychain path." >&2
  exit 1
fi

# Read the password with echo disabled so it never lands on screen. Passing it
# via -k (rather than omitting it) avoids the cascade of per-key GUI approval
# dialogs that set-key-partition-list otherwise triggers; the trade-off is that
# the password is briefly visible in `ps` to other local users while `security`
# runs. `security` has no stdin form for it, so this matches what fastlane match
# does and is acceptable on a single-user Mac.
printf 'macOS login password (for %s): ' "$LOGIN_KEYCHAIN" >&2
saved_stty="$(stty -g 2> /dev/null || true)"
stty -echo 2> /dev/null || true
IFS= read -r KEYCHAIN_PASSWORD
if [ -n "$saved_stty" ]; then
  stty "$saved_stty" 2> /dev/null || true
else
  stty echo 2> /dev/null || true
fi
printf '\n' >&2

echo "Authorizing codesign to use signing keys in: $LOGIN_KEYCHAIN"
security set-key-partition-list \
  -S apple-tool:,apple:,codesign: \
  -s \
  -k "$KEYCHAIN_PASSWORD" \
  "$LOGIN_KEYCHAIN"
unset KEYCHAIN_PASSWORD
echo "codesign is now authorized to use the login keychain's signing keys."
