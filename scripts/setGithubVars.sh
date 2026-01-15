#!/bin/sh
set -e
SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)

cd "$SCRIPT_DIR/.."

check_var() {
  var_name="$1"
  eval "var_value=\$$var_name"
  if [ -z "$var_value" ]; then
    echo "Error: $var_name is not set."
    exit 1
  fi
}

# iOS / Apple
check_var "APPLE_ID"
check_var "TEAM_ID"
check_var "ITC_TEAM_ID"
check_var "GITHUB_REPO"
check_var "APP_STORE_CONNECT_ISSUER_ID"
check_var "APP_STORE_CONNECT_KEY_ID"
check_var "MATCH_GIT_URL"
check_var "MATCH_PASSWORD"
check_var "MATCH_GIT_BASIC_AUTHORIZATION"

# Android
check_var "ANDROID_KEYSTORE_STORE_PASS"
check_var "ANDROID_KEYSTORE_KEY_PASS"

# Anthropic (for release notes generation)
check_var "ANTHROPIC_API_KEY"

# Server Deploy
check_var "TF_VAR_domain"
check_var "TF_VAR_server_username"
check_var "VITE_API_URL"

# https://appstoreconnect.apple.com/access/integrations/api
P8_FILE=".secrets/AuthKey_${APP_STORE_CONNECT_KEY_ID}.p8"

if [ ! -f "$P8_FILE" ]; then
  echo "Error: .p8 file not found at $P8_FILE"
  exit 1
fi

KEYSTORE_FILE=".secrets/tearleads-release.keystore"

if [ ! -f "$KEYSTORE_FILE" ]; then
  echo "Error: Android keystore not found at $KEYSTORE_FILE"
  exit 1
fi

# https://console.cloud.google.com/iam-admin/serviceaccounts
GOOGLE_PLAY_JSON_FILE=".secrets/google-play-service-account.json"

if [ ! -f "$GOOGLE_PLAY_JSON_FILE" ]; then
  echo "Error: Google Play service account JSON not found at $GOOGLE_PLAY_JSON_FILE"
  exit 1
fi

DEPLOY_KEY_FILE=".secrets/deploy.key"

if [ ! -f "$DEPLOY_KEY_FILE" ]; then
  echo "Error: Deploy SSH key not found at $DEPLOY_KEY_FILE"
  exit 1
fi

API_KEY_BASE64=$(base64 < "$P8_FILE")
DEPLOY_SSH_KEY=$(cat "$DEPLOY_KEY_FILE")
ANDROID_KEYSTORE_BASE64=$(base64 < "$KEYSTORE_FILE")
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64=$(base64 < "$GOOGLE_PLAY_JSON_FILE")

set_secret() {
  secret_name="$1"
  secret_value="$2"
  gh secret set "$secret_name" -R "$GITHUB_REPO" --body "$secret_value"
}

set_secret "APPLE_ID" "$APPLE_ID"
set_secret "TEAM_ID" "$TEAM_ID"
set_secret "ITC_TEAM_ID" "$ITC_TEAM_ID"
set_secret "APP_STORE_CONNECT_KEY_ID" "$APP_STORE_CONNECT_KEY_ID"
set_secret "APP_STORE_CONNECT_ISSUER_ID" "$APP_STORE_CONNECT_ISSUER_ID"
set_secret "APP_STORE_CONNECT_API_KEY" "$API_KEY_BASE64"
set_secret "MATCH_GIT_URL" "$MATCH_GIT_URL"
set_secret "MATCH_PASSWORD" "$MATCH_PASSWORD"
set_secret "MATCH_GIT_BASIC_AUTHORIZATION" "$MATCH_GIT_BASIC_AUTHORIZATION"

# Android secrets
set_secret "ANDROID_KEYSTORE_BASE64" "$ANDROID_KEYSTORE_BASE64"
set_secret "ANDROID_KEYSTORE_STORE_PASS" "$ANDROID_KEYSTORE_STORE_PASS"
set_secret "ANDROID_KEYSTORE_KEY_PASS" "$ANDROID_KEYSTORE_KEY_PASS"
set_secret "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON" "$GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64"

# Anthropic
set_secret "ANTHROPIC_API_KEY" "$ANTHROPIC_API_KEY"

# Deploy
set_secret "DEPLOY_SSH_KEY" "$DEPLOY_SSH_KEY"
# shellcheck disable=SC2154 # validated by check_var
set_secret "DEPLOY_DOMAIN" "$TF_VAR_domain"
# shellcheck disable=SC2154 # validated by check_var
set_secret "DEPLOY_USER" "$TF_VAR_server_username"
# shellcheck disable=SC2154 # validated by check_var
set_secret "VITE_API_URL" "$VITE_API_URL"

echo ""
echo "All secrets have been set successfully!"
