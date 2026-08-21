#!/bin/sh
set -eu

usage() {
  cat <<EOF
Usage: $(basename "$0") [--force] [provisioning-profile]

Grant codesign non-interactive access to the private keys in the login
keychain, so an iOS release archive can be signed from an automated shell
without a GUI "codesign wants to use your key" prompt.

When a provisioning profile is provided, verify its exact distribution key
first and exit without prompting if codesign can already use it. Without a
profile, verify every installed Apple Distribution identity.

Run this in your own Terminal (a real GUI login session). You are prompted for
your macOS login password only when the codesign probe fails. Use --force when
another macOS security session fails even though the probe succeeds here.

Run unlockLoginKeychain.sh first if you only want to unlock without changing
the partition list.
EOF
}

FORCE_AUTHORIZATION=0
PROFILE_PATH=""
for argument in "$@"; do
  case "$argument" in
    -h | --help)
      usage
      exit 0
      ;;
    --force)
      FORCE_AUTHORIZATION=1
      ;;
    -*)
      echo "Error: unknown option: $argument" >&2
      usage >&2
      exit 1
      ;;
    *)
      if [ -n "$PROFILE_PATH" ]; then
        echo "Error: only one provisioning profile may be provided." >&2
        exit 1
      fi
      PROFILE_PATH="$argument"
      ;;
  esac
done

# Resolve the login keychain rather than hard-coding a per-user path.
resolve_login_keychain() {
  security login-keychain \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//'
}

LOGIN_KEYCHAIN="${CODESIGN_LOGIN_KEYCHAIN:-$(resolve_login_keychain)}"
if [ -z "$LOGIN_KEYCHAIN" ]; then
  echo "Error: could not determine the login keychain path." >&2
  exit 1
fi

codesign_profile_identity() {
  profile_certificate="$({
    security cms -D -i "$PROFILE_PATH" |
      plutil -extract DeveloperCertificates.0 raw -o - -
  })" || return 1
  printf '%s' "$profile_certificate" |
    base64 -D |
    openssl x509 -inform DER -noout -fingerprint -sha1 |
    sed -e 's/^.*=//' -e 's/://g'
}

codesign_distribution_identities() {
  security find-identity -v -p codesigning |
    awk '/"Apple Distribution:/{print $2}'
}

codesign_probe_identity() {
  probe_identity="$1"
  probe_file="$(mktemp "${TMPDIR:-/tmp}/symcrypt-codesign-probe.XXXXXX")"
  cp /usr/bin/true "$probe_file"
  if "${CODESIGN_COMMAND:-/usr/bin/codesign}" \
    --force \
    --sign "$probe_identity" \
    "$probe_file" >/dev/null 2>&1; then
    rm -f "$probe_file"
    return 0
  fi
  rm -f "$probe_file"
  return 1
}

codesign_probe_identities() {
  probe_identities="$1"
  [ -n "$probe_identities" ] || return 1
  for probe_identity in $probe_identities; do
    codesign_probe_identity "$probe_identity" || return 1
  done
}

if [ -n "${CODESIGN_PROBE_IDENTITY:-}" ]; then
  CODESIGN_IDENTITIES="$CODESIGN_PROBE_IDENTITY"
elif [ -n "$PROFILE_PATH" ]; then
  if [ ! -f "$PROFILE_PATH" ]; then
    echo "Error: provisioning profile does not exist: $PROFILE_PATH" >&2
    exit 1
  fi
  CODESIGN_IDENTITIES="$(codesign_profile_identity)"
else
  CODESIGN_IDENTITIES="$(codesign_distribution_identities)"
fi

if [ "$FORCE_AUTHORIZATION" = 0 ] && codesign_probe_identities "$CODESIGN_IDENTITIES"; then
  echo "codesign key access is already authorized; no password prompt needed."
  exit 0
fi

if [ ! -t 0 ]; then
  echo "Error: codesign key access requires interactive authorization." >&2
  exit 1
fi

# Read the password with echo disabled so it never lands on screen. Passing it
# via -k avoids the cascade of per-key GUI approval dialogs; the trade-off is
# that it is briefly visible in `ps` to other local users while `security` runs.
# The command has no stdin form, matching fastlane match's behavior on a
# single-user Mac.
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
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$LOGIN_KEYCHAIN"
security set-key-partition-list \
  -S apple-tool:,apple:,codesign: \
  -s \
  -k "$KEYCHAIN_PASSWORD" \
  "$LOGIN_KEYCHAIN"
unset KEYCHAIN_PASSWORD

if ! codesign_probe_identities "$CODESIGN_IDENTITIES"; then
  echo "Error: codesign still cannot use the required signing key." >&2
  exit 1
fi
echo "codesign is now authorized to use the required signing key."
