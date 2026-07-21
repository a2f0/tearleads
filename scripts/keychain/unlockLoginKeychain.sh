#!/bin/sh
set -eu

usage() {
  cat <<EOF
Usage: $(basename "$0")

Unlock the macOS login keychain so codesign can read the iOS signing key.

Run this in your own Terminal (a real GUI login session), NOT from an
automated/sandboxed shell — keychain access needs an interactive session.
The \`security\` tool prompts for your macOS login password (input hidden).

Pairs with authorizeCodesignPartitionList.sh, which grants codesign
non-interactive access to the signing keys after the keychain is unlocked.
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

echo "Unlocking login keychain: $LOGIN_KEYCHAIN"
security unlock-keychain "$LOGIN_KEYCHAIN"
echo "Login keychain unlocked."
