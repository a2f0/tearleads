#!/bin/sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ANDROID_GRADLE="$REPO_ROOT/packages/client/android/app/build.gradle"
IOS_PBXPROJ="$REPO_ROOT/packages/client/ios/App/App.xcodeproj/project.pbxproj"
API_PACKAGE="$REPO_ROOT/packages/api/package.json"

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

echo "Bumping versions:"
echo "  Android: $ANDROID_VERSION -> $NEW_ANDROID_VERSION"
echo "  iOS:     $IOS_VERSION -> $NEW_IOS_VERSION"
echo "  API:     $API_VERSION -> $NEW_API_VERSION"

# Update Android versionCode and versionName
sed -i '' "s/versionCode $ANDROID_VERSION/versionCode $NEW_ANDROID_VERSION/" "$ANDROID_GRADLE"
sed -i '' "s/versionName \"1.0.$ANDROID_VERSION\"/versionName \"1.0.$NEW_ANDROID_VERSION\"/" "$ANDROID_GRADLE"

# Update iOS CURRENT_PROJECT_VERSION (appears twice: Debug and Release)
sed -i '' "s/CURRENT_PROJECT_VERSION = $IOS_VERSION/CURRENT_PROJECT_VERSION = $NEW_IOS_VERSION/g" "$IOS_PBXPROJ"

# Update API version
sed -i '' "s/\"version\": \"$API_VERSION\"/\"version\": \"$NEW_API_VERSION\"/" "$API_PACKAGE"

echo "Done."
