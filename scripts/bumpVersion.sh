#!/bin/sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
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

# Get current Android versionCode
ANDROID_VERSION=$(grep -E 'versionCode [0-9]+' "$ANDROID_GRADLE" | head -1 | sed 's/.*versionCode \([0-9]*\).*/\1/')
NEW_ANDROID_VERSION=$((ANDROID_VERSION + 1))

# Get current iOS build number
IOS_VERSION=$(grep -E 'CURRENT_PROJECT_VERSION = [0-9]+' "$IOS_PBXPROJ" | head -1 | sed 's/.*= \([0-9]*\).*/\1/')
NEW_IOS_VERSION=$((IOS_VERSION + 1))

# Get current API version (patch number)
API_VERSION=$(grep -E '"version": "' "$API_PACKAGE" | head -1 | sed 's/.*"version": "\([^"]*\)".*/\1/')
API_MAJOR=$(echo "$API_VERSION" | cut -d. -f1)
API_MINOR=$(echo "$API_VERSION" | cut -d. -f2)
API_PATCH=$(echo "$API_VERSION" | cut -d. -f3)
NEW_API_PATCH=$((API_PATCH + 1))
NEW_API_VERSION="$API_MAJOR.$API_MINOR.$NEW_API_PATCH"

# Get current Client version (patch number)
CLIENT_VERSION=$(grep -E '"version": "' "$CLIENT_PACKAGE" | head -1 | sed 's/.*"version": "\([^"]*\)".*/\1/')
CLIENT_MAJOR=$(echo "$CLIENT_VERSION" | cut -d. -f1)
CLIENT_MINOR=$(echo "$CLIENT_VERSION" | cut -d. -f2)
CLIENT_PATCH=$(echo "$CLIENT_VERSION" | cut -d. -f3)
NEW_CLIENT_PATCH=$((CLIENT_PATCH + 1))
NEW_CLIENT_VERSION="$CLIENT_MAJOR.$CLIENT_MINOR.$NEW_CLIENT_PATCH"

echo "Bumping versions:"
echo "  Android: $ANDROID_VERSION -> $NEW_ANDROID_VERSION"
echo "  iOS:     $IOS_VERSION -> $NEW_IOS_VERSION"
echo "  API:     $API_VERSION -> $NEW_API_VERSION"
echo "  Client:  $CLIENT_VERSION -> $NEW_CLIENT_VERSION"

# Update Android versionCode and versionName
sedi "s/versionCode $ANDROID_VERSION/versionCode $NEW_ANDROID_VERSION/" "$ANDROID_GRADLE"
sedi "s/versionName \"1.0.$ANDROID_VERSION\"/versionName \"1.0.$NEW_ANDROID_VERSION\"/" "$ANDROID_GRADLE"

# Update iOS CURRENT_PROJECT_VERSION (appears twice: Debug and Release)
sedi "s/CURRENT_PROJECT_VERSION = $IOS_VERSION/CURRENT_PROJECT_VERSION = $NEW_IOS_VERSION/g" "$IOS_PBXPROJ"

# Update API version
sedi "s/\"version\": \"$API_VERSION\"/\"version\": \"$NEW_API_VERSION\"/" "$API_PACKAGE"

# Update Client version
sedi "s/\"version\": \"$CLIENT_VERSION\"/\"version\": \"$NEW_CLIENT_VERSION\"/" "$CLIENT_PACKAGE"

echo "Done."
