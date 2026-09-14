# shellcheck shell=bash
# Resolve existing local Apple credentials without printing private values.
configure_macos_signing() {
  : "${REPO_ROOT:?Set REPO_ROOT before configuring macOS signing}"
  if [[ -z "${ELECTROBUN_DEVELOPER_ID:-}" ]]; then
    ELECTROBUN_DEVELOPER_ID="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | sort -u)"
  fi
  if [[ -z "$ELECTROBUN_DEVELOPER_ID" || "$ELECTROBUN_DEVELOPER_ID" == *$'\n'* ]]; then
    echo "Set ELECTROBUN_DEVELOPER_ID to one installed Developer ID Application identity." >&2
    return 1
  fi
  export ELECTROBUN_DEVELOPER_ID
  export ELECTROBUN_APPLEAPIKEY="${ELECTROBUN_APPLEAPIKEY:-${APP_STORE_CONNECT_KEY_ID:-}}"
  export ELECTROBUN_APPLEAPIISSUER="${ELECTROBUN_APPLEAPIISSUER:-${APP_STORE_CONNECT_ISSUER_ID:-}}"
  export ELECTROBUN_APPLEAPIKEYPATH="${ELECTROBUN_APPLEAPIKEYPATH:-${APP_STORE_CONNECT_API_KEY_KEY_FILEPATH:-${APP_STORE_CONNECT_KEY_FILEPATH:-$REPO_ROOT/.secrets/AuthKey_${ELECTROBUN_APPLEAPIKEY}.p8}}}"
  if [[ -z "$ELECTROBUN_APPLEAPIKEY" || -z "$ELECTROBUN_APPLEAPIISSUER" || ! -f "$ELECTROBUN_APPLEAPIKEYPATH" ]]; then
    echo "App Store Connect key ID, issuer, and private key file are required for notarization." >&2
    return 1
  fi
  ELECTROBUN_APPLEAPIKEYPATH="$(cd -- "$(dirname -- "$ELECTROBUN_APPLEAPIKEYPATH")" && pwd -P)/$(basename -- "$ELECTROBUN_APPLEAPIKEYPATH")"
  export ELECTROBUN_APPLEAPIKEYPATH
  if [[ -n "${ELECTROBUN_SKIP_NOTARIZATION:-}" ]]; then
    echo "Unset ELECTROBUN_SKIP_NOTARIZATION for a downloadable release." >&2
    return 1
  fi
}
