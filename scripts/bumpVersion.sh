#!/bin/sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ANDROID_GRADLE="$REPO_ROOT/packages/client/android/app/build.gradle"
IOS_PBXPROJ="$REPO_ROOT/packages/client/ios/App/App.xcodeproj/project.pbxproj"

# Get current Android versionCode
ANDROID_VERSION=$(grep -E 'versionCode [0-9]+' "$ANDROID_GRADLE" | head -1 | sed 's/.*versionCode \([0-9]*\).*/\1/')
NEW_ANDROID_VERSION=$((ANDROID_VERSION + 1))

# Get current iOS build number
IOS_VERSION=$(grep -E 'CURRENT_PROJECT_VERSION = [0-9]+' "$IOS_PBXPROJ" | head -1 | sed 's/.*= \([0-9]*\).*/\1/')
NEW_IOS_VERSION=$((IOS_VERSION + 1))

echo "Bumping versions:"
echo "  Android: $ANDROID_VERSION -> $NEW_ANDROID_VERSION"
echo "  iOS:     $IOS_VERSION -> $NEW_IOS_VERSION"

# Update Android versionCode and versionName
sed -i '' "s/versionCode $ANDROID_VERSION/versionCode $NEW_ANDROID_VERSION/" "$ANDROID_GRADLE"
sed -i '' "s/versionName \"1.0.$ANDROID_VERSION\"/versionName \"1.0.$NEW_ANDROID_VERSION\"/" "$ANDROID_GRADLE"

# Update iOS CURRENT_PROJECT_VERSION (appears twice: Debug and Release)
sed -i '' "s/CURRENT_PROJECT_VERSION = $IOS_VERSION/CURRENT_PROJECT_VERSION = $NEW_IOS_VERSION/g" "$IOS_PBXPROJ"

echo "Done."
