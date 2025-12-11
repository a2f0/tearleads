#!/bin/sh
set -e

check_var() {
  var_name="$1"
  eval "var_value=\$$var_name"
  if [ -z "$var_value" ]; then
    echo "Error: $var_name is not set."
    echo ""
    echo "Please export all required variables:"
    echo "  export APPLE_ID=your-apple-id@example.com"
    echo "  export TEAM_ID=YOUR_TEAM_ID"
    echo "  export ITC_TEAM_ID=YOUR_ITC_TEAM_ID"
    echo "  export GITHUB_REPO=username/repo"
    echo "  export APP_STORE_CONNECT_ISSUER_ID=your-issuer-id"
    echo "  export APP_STORE_CONNECT_KEY_ID=YOUR_KEY_ID"
    echo "  export MATCH_GIT_URL=git@github.com:username/certificates.git"
    echo "  export MATCH_PASSWORD=your-match-password"
    echo "  export MATCH_GIT_BASIC_AUTHORIZATION=base64-encoded-username:token"
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

echo "$APPLE_ID" | gh secret set APPLE_ID -R "$GITHUB_REPO"
echo "$TEAM_ID" | gh secret set TEAM_ID -R "$GITHUB_REPO"
echo "$ITC_TEAM_ID" | gh secret set ITC_TEAM_ID -R "$GITHUB_REPO"
echo "$APP_STORE_CONNECT_KEY_ID" | gh secret set APP_STORE_CONNECT_KEY_ID -R "$GITHUB_REPO"
echo "$APP_STORE_CONNECT_ISSUER_ID" | gh secret set APP_STORE_CONNECT_ISSUER_ID -R "$GITHUB_REPO"
echo "$API_KEY_BASE64" | gh secret set APP_STORE_CONNECT_API_KEY -R "$GITHUB_REPO"
echo "$MATCH_GIT_URL" | gh secret set MATCH_GIT_URL -R "$GITHUB_REPO"
echo "$MATCH_PASSWORD" | gh secret set MATCH_PASSWORD -R "$GITHUB_REPO"
echo "$MATCH_GIT_BASIC_AUTHORIZATION" | gh secret set MATCH_GIT_BASIC_AUTHORIZATION -R "$GITHUB_REPO"
