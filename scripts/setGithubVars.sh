#!/bin/sh
set -e

check_var() {
  var_name="$1"
  eval "var_value=\$$var_name"
  if [ -z "$var_value" ]; then
    echo "Error: $var_name is not set."
    exit 1
  fi
}

check_var "APPLE_ID"
check_var "TEAM_ID"
check_var "ITC_TEAM_ID"
check_var "GITHUB_REPO"
check_var "APP_STORE_CONNECT_ISSUER_ID"
check_var "APP_STORE_CONNECT_KEY_ID"
check_var "MATCH_GIT_URL"
check_var "MATCH_PASSWORD"
check_var "MATCH_GIT_BASIC_AUTHORIZATION"

# https://appstoreconnect.apple.com/access/integrations/api
P8_FILE=".secrets/AuthKey_${APP_STORE_CONNECT_KEY_ID}.p8"

if [ ! -f "$P8_FILE" ]; then
  echo "Error: .p8 file not found at $P8_FILE"
  exit 1
fi

API_KEY_BASE64=$(base64 < "$P8_FILE")

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

echo ""
echo "All secrets have been set successfully!"
