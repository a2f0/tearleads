#!/bin/sh
set -eu
SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)

REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Cross-platform sed -i (macOS needs '', Linux doesn't)
sedi() {
  if [ "$(uname)" = "Darwin" ]; then
    sed -i '' "$@"
  else
    sed -i "$@"
  fi
}

ANDROID_GRADLE="$REPO_ROOT/packages/client/android/app/build.gradle"
IOS_PBXPROJ="$REPO_ROOT/packages/client/ios/App/App.xcodeproj/project.pbxproj"
API_PACKAGE="$REPO_ROOT/packages/api/package.json"
CLIENT_PACKAGE="$REPO_ROOT/packages/client/package.json"
CHROME_EXT_PACKAGE="$REPO_ROOT/packages/chrome-extension/package.json"
CHROME_EXT_MANIFEST="$REPO_ROOT/packages/chrome-extension/public/manifest.json"

# Get current Android versionCode and versionName
ANDROID_VERSION=$(grep -E 'versionCode [0-9]+' "$ANDROID_GRADLE" | head -1 | sed 's/.*versionCode \([0-9]*\).*/\1/')
NEW_ANDROID_VERSION=$((ANDROID_VERSION + 1))

# Get current versionName prefix (major.minor) to avoid hardcoding
ANDROID_VERSION_NAME=$(grep -E 'versionName "[^"]+"' "$ANDROID_GRADLE" | head -1 | sed 's/.*versionName "\([^"]*\)".*/\1/')
ANDROID_VERSION_PREFIX=$(echo "$ANDROID_VERSION_NAME" | sed 's/\.[0-9]*$//')
NEW_ANDROID_VERSION_NAME="$ANDROID_VERSION_PREFIX.$NEW_ANDROID_VERSION"

# Get current iOS build number
IOS_VERSION=$(grep -E 'CURRENT_PROJECT_VERSION = [0-9]+' "$IOS_PBXPROJ" | head -1 | sed 's/.*= \([0-9]*\).*/\1/')
NEW_IOS_VERSION=$((IOS_VERSION + 1))

# Get current API version using jq (more robust than sed for JSON)
API_VERSION=$(jq -r '.version' "$API_PACKAGE")
API_MAJOR=$(echo "$API_VERSION" | cut -d. -f1)
API_MINOR=$(echo "$API_VERSION" | cut -d. -f2)
API_PATCH=$(echo "$API_VERSION" | cut -d. -f3)
NEW_API_PATCH=$((API_PATCH + 1))
NEW_API_VERSION="$API_MAJOR.$API_MINOR.$NEW_API_PATCH"

# Get current Client version using jq
CLIENT_VERSION=$(jq -r '.version' "$CLIENT_PACKAGE")
CLIENT_MAJOR=$(echo "$CLIENT_VERSION" | cut -d. -f1)
CLIENT_MINOR=$(echo "$CLIENT_VERSION" | cut -d. -f2)
CLIENT_PATCH=$(echo "$CLIENT_VERSION" | cut -d. -f3)
NEW_CLIENT_PATCH=$((CLIENT_PATCH + 1))
NEW_CLIENT_VERSION="$CLIENT_MAJOR.$CLIENT_MINOR.$NEW_CLIENT_PATCH"

# Get current Chrome Extension version using jq
CHROME_EXT_VERSION=$(jq -r '.version' "$CHROME_EXT_PACKAGE")
CHROME_EXT_MAJOR=$(echo "$CHROME_EXT_VERSION" | cut -d. -f1)
CHROME_EXT_MINOR=$(echo "$CHROME_EXT_VERSION" | cut -d. -f2)
CHROME_EXT_PATCH=$(echo "$CHROME_EXT_VERSION" | cut -d. -f3)
NEW_CHROME_EXT_PATCH=$((CHROME_EXT_PATCH + 1))
NEW_CHROME_EXT_VERSION="$CHROME_EXT_MAJOR.$CHROME_EXT_MINOR.$NEW_CHROME_EXT_PATCH"

echo "Bumping versions:"
echo "  Android:    $ANDROID_VERSION -> $NEW_ANDROID_VERSION"
echo "  iOS:        $IOS_VERSION -> $NEW_IOS_VERSION"
echo "  API:        $API_VERSION -> $NEW_API_VERSION"
echo "  Client:     $CLIENT_VERSION -> $NEW_CLIENT_VERSION"
echo "  Chrome Ext: $CHROME_EXT_VERSION -> $NEW_CHROME_EXT_VERSION"

# Update Android versionCode and versionName (using dynamic prefix)
sedi "s/versionCode $ANDROID_VERSION/versionCode $NEW_ANDROID_VERSION/" "$ANDROID_GRADLE"
sedi "s/versionName \"$ANDROID_VERSION_NAME\"/versionName \"$NEW_ANDROID_VERSION_NAME\"/" "$ANDROID_GRADLE"

# Update iOS CURRENT_PROJECT_VERSION (appears twice: Debug and Release)
sedi "s/CURRENT_PROJECT_VERSION = $IOS_VERSION/CURRENT_PROJECT_VERSION = $NEW_IOS_VERSION/g" "$IOS_PBXPROJ"

# Update API version using jq (more robust than sed for JSON)
TMP_FILE=$(mktemp)
jq --arg v "$NEW_API_VERSION" '.version = $v' "$API_PACKAGE" > "$TMP_FILE" && mv "$TMP_FILE" "$API_PACKAGE"

# Update Client version using jq
TMP_FILE=$(mktemp)
jq --arg v "$NEW_CLIENT_VERSION" '.version = $v' "$CLIENT_PACKAGE" > "$TMP_FILE" && mv "$TMP_FILE" "$CLIENT_PACKAGE"

# Update Chrome Extension version using jq (both package.json and manifest.json)
TMP_FILE=$(mktemp)
jq --arg v "$NEW_CHROME_EXT_VERSION" '.version = $v' "$CHROME_EXT_PACKAGE" > "$TMP_FILE" && mv "$TMP_FILE" "$CHROME_EXT_PACKAGE"
TMP_FILE=$(mktemp)
jq --arg v "$NEW_CHROME_EXT_VERSION" '.version = $v' "$CHROME_EXT_MANIFEST" > "$TMP_FILE" && mv "$TMP_FILE" "$CHROME_EXT_MANIFEST"

echo "Done."
