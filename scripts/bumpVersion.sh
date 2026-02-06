#!/bin/sh
set -eu

# Find repo root from current working directory (not script location)
# This ensures the script operates on the repo where it's invoked, not where it's located
REPO_ROOT="$(git rev-parse --show-toplevel)"
BASE_BRANCH="${BASE_BRANCH:-main}"
DRY_RUN=false

if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=true
fi

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
CLI_PACKAGE="$REPO_ROOT/packages/cli/package.json"
CLIENT_PACKAGE="$REPO_ROOT/packages/client/package.json"
CHROME_EXT_PACKAGE="$REPO_ROOT/packages/chrome-extension/package.json"
CHROME_EXT_MANIFEST="$REPO_ROOT/packages/chrome-extension/public/manifest.json"
EMAIL_PACKAGE="$REPO_ROOT/packages/email/package.json"
NOTES_PACKAGE="$REPO_ROOT/packages/notes/package.json"
UI_PACKAGE="$REPO_ROOT/packages/ui/package.json"
VFS_EXPLORER_PACKAGE="$REPO_ROOT/packages/vfs-explorer/package.json"
WEBSITE_PACKAGE="$REPO_ROOT/packages/website/package.json"

is_version_only_change() {
  FILE_PATH="$1"

  case "$FILE_PATH" in
    */package.json|*/manifest.json)
      NORMALIZE_CMD="jq -S 'del(.version)'"
      ;;
    */android/app/build.gradle)
      NORMALIZE_CMD="sed -E '/versionCode [0-9]+/d; /versionName \"[^\"]+\"/d'"
      ;;
    */ios/App/App.xcodeproj/project.pbxproj)
      NORMALIZE_CMD="sed -E '/CURRENT_PROJECT_VERSION = [0-9]+/d'"
      ;;
    *)
      return 1
      ;;
  esac

  if ! git cat-file -e "$BASE_BRANCH:$FILE_PATH" 2>/dev/null; then
    return 1
  fi

  if [ ! -f "$REPO_ROOT/$FILE_PATH" ]; then
    return 1
  fi

  BASE_TMP=$(mktemp)
  HEAD_TMP=$(mktemp)

  if ! git show "$BASE_BRANCH:$FILE_PATH" | sh -c "$NORMALIZE_CMD" > "$BASE_TMP"; then
    rm -f "$BASE_TMP" "$HEAD_TMP"
    return 1
  fi

  if ! sh -c "$NORMALIZE_CMD" < "$REPO_ROOT/$FILE_PATH" > "$HEAD_TMP"; then
    rm -f "$BASE_TMP" "$HEAD_TMP"
    return 1
  fi

  if cmp -s "$BASE_TMP" "$HEAD_TMP"; then
    rm -f "$BASE_TMP" "$HEAD_TMP"
    return 0
  fi

  rm -f "$BASE_TMP" "$HEAD_TMP"
  return 1
}

has_changes() {
  TARGET_DIR="$1"
  shift

  CHANGED_FILES=$(git diff --name-only "$BASE_BRANCH"...HEAD -- "$TARGET_DIR")

  if [ -z "$CHANGED_FILES" ]; then
    return 1
  fi

  OLD_IFS="$IFS"
  IFS='
'
  for FILE_PATH in $CHANGED_FILES; do
    SHOULD_IGNORE=false
    for VERSION_FILE in "$@"; do
      if [ "$FILE_PATH" = "$VERSION_FILE" ]; then
        SHOULD_IGNORE=true
        break
      fi
    done

    if [ "$SHOULD_IGNORE" = "true" ] && is_version_only_change "$FILE_PATH"; then
      continue
    fi

    IFS="$OLD_IFS"
    return 0
  done

  IFS="$OLD_IFS"
  return 1
}

API_CHANGED=false
CLI_CHANGED=false
CHROME_EXT_CHANGED=false
CLIENT_CHANGED=false
EMAIL_CHANGED=false
NOTES_CHANGED=false
UI_CHANGED=false
VFS_EXPLORER_CHANGED=false
WEBSITE_CHANGED=false

has_changes "packages/api" "packages/api/package.json" && API_CHANGED=true
has_changes "packages/cli" "packages/cli/package.json" && CLI_CHANGED=true
has_changes "packages/chrome-extension" \
  "packages/chrome-extension/package.json" \
  "packages/chrome-extension/public/manifest.json" && CHROME_EXT_CHANGED=true
has_changes "packages/client" \
  "packages/client/package.json" \
  "packages/client/android/app/build.gradle" \
  "packages/client/ios/App/App.xcodeproj/project.pbxproj" && CLIENT_CHANGED=true
has_changes "packages/email" "packages/email/package.json" && EMAIL_CHANGED=true
has_changes "packages/notes" "packages/notes/package.json" && NOTES_CHANGED=true
has_changes "packages/ui" "packages/ui/package.json" && UI_CHANGED=true
has_changes "packages/vfs-explorer" "packages/vfs-explorer/package.json" && VFS_EXPLORER_CHANGED=true
has_changes "packages/website" "packages/website/package.json" && WEBSITE_CHANGED=true

bump_npm_package_version() {
  PKG_LABEL="$1"
  PKG_PATH="$2"
  PKG_CHANGED="$3"
  PKG_DIR_NAME=$(basename "$(dirname "$PKG_PATH")")

  if [ "$PKG_CHANGED" != "true" ]; then
    printf "  %-12s: %s\n" "$PKG_LABEL" "no changes in packages/$PKG_DIR_NAME (skipping)"
    return
  fi

  CURRENT_VERSION=$(jq -r '.version' "$PKG_PATH")
  MAJOR=$(echo "$CURRENT_VERSION" | cut -d. -f1)
  MINOR=$(echo "$CURRENT_VERSION" | cut -d. -f2)
  PATCH=$(echo "$CURRENT_VERSION" | cut -d. -f3)
  NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"

  printf "  %-12s: %s -> %s\n" "$PKG_LABEL" "$CURRENT_VERSION" "$NEW_VERSION"

  if [ "$DRY_RUN" = "true" ]; then
    printf "  (dry-run) Update %s version\n" "$PKG_PATH"
  else
    TMP_FILE=$(mktemp)
    jq --arg v "$NEW_VERSION" '.version = $v' "$PKG_PATH" > "$TMP_FILE" && mv "$TMP_FILE" "$PKG_PATH"
  fi
}

printf "Bumping versions (base: %s):\n" "$BASE_BRANCH"

if [ "$CLIENT_CHANGED" = "true" ]; then
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

  # Get current Client version using jq
  CLIENT_VERSION=$(jq -r '.version' "$CLIENT_PACKAGE")
  CLIENT_MAJOR=$(echo "$CLIENT_VERSION" | cut -d. -f1)
  CLIENT_MINOR=$(echo "$CLIENT_VERSION" | cut -d. -f2)
  CLIENT_PATCH=$(echo "$CLIENT_VERSION" | cut -d. -f3)
  NEW_CLIENT_PATCH=$((CLIENT_PATCH + 1))
  NEW_CLIENT_VERSION="$CLIENT_MAJOR.$CLIENT_MINOR.$NEW_CLIENT_PATCH"

  printf "  %-12s: %s -> %s\n" "Android" "$ANDROID_VERSION" "$NEW_ANDROID_VERSION"
  printf "  %-12s: %s -> %s\n" "iOS" "$IOS_VERSION" "$NEW_IOS_VERSION"
  printf "  %-12s: %s -> %s\n" "Client" "$CLIENT_VERSION" "$NEW_CLIENT_VERSION"

  if [ "$DRY_RUN" = "true" ]; then
    printf "  (dry-run) Update Android versionCode/versionName\n"
    printf "  (dry-run) Update iOS CURRENT_PROJECT_VERSION\n"
    printf "  (dry-run) Update packages/client/package.json version\n"
  else
    # Update Android versionCode and versionName (using dynamic prefix)
    sedi "s/versionCode $ANDROID_VERSION/versionCode $NEW_ANDROID_VERSION/" "$ANDROID_GRADLE"
    sedi "s/versionName \"$ANDROID_VERSION_NAME\"/versionName \"$NEW_ANDROID_VERSION_NAME\"/" "$ANDROID_GRADLE"

    # Update iOS CURRENT_PROJECT_VERSION (appears twice: Debug and Release)
    sedi "s/CURRENT_PROJECT_VERSION = $IOS_VERSION/CURRENT_PROJECT_VERSION = $NEW_IOS_VERSION/g" "$IOS_PBXPROJ"

    # Update Client version using jq
    TMP_FILE=$(mktemp)
    jq --arg v "$NEW_CLIENT_VERSION" '.version = $v' "$CLIENT_PACKAGE" > "$TMP_FILE" && mv "$TMP_FILE" "$CLIENT_PACKAGE"
  fi
else
  printf "  %-12s: %s\n" "Client" "no changes in packages/client (skipping)"
fi

bump_npm_package_version "API" "$API_PACKAGE" "$API_CHANGED"
bump_npm_package_version "CLI" "$CLI_PACKAGE" "$CLI_CHANGED"
bump_npm_package_version "Email" "$EMAIL_PACKAGE" "$EMAIL_CHANGED"
bump_npm_package_version "Notes" "$NOTES_PACKAGE" "$NOTES_CHANGED"
bump_npm_package_version "UI" "$UI_PACKAGE" "$UI_CHANGED"
bump_npm_package_version "VFS Explorer" "$VFS_EXPLORER_PACKAGE" "$VFS_EXPLORER_CHANGED"
bump_npm_package_version "Website" "$WEBSITE_PACKAGE" "$WEBSITE_CHANGED"

if [ "$CHROME_EXT_CHANGED" = "true" ]; then
  # Get current Chrome Extension version using jq
  CHROME_EXT_VERSION=$(jq -r '.version' "$CHROME_EXT_PACKAGE")
  CHROME_EXT_MAJOR=$(echo "$CHROME_EXT_VERSION" | cut -d. -f1)
  CHROME_EXT_MINOR=$(echo "$CHROME_EXT_VERSION" | cut -d. -f2)
  CHROME_EXT_PATCH=$(echo "$CHROME_EXT_VERSION" | cut -d. -f3)
  NEW_CHROME_EXT_PATCH=$((CHROME_EXT_PATCH + 1))
  NEW_CHROME_EXT_VERSION="$CHROME_EXT_MAJOR.$CHROME_EXT_MINOR.$NEW_CHROME_EXT_PATCH"

  printf "  %-12s: %s -> %s\n" "Chrome Ext" "$CHROME_EXT_VERSION" "$NEW_CHROME_EXT_VERSION"

  if [ "$DRY_RUN" = "true" ]; then
    printf "  (dry-run) Update packages/chrome-extension/package.json version\n"
    printf "  (dry-run) Update packages/chrome-extension/public/manifest.json version\n"
  else
    # Update Chrome Extension version using jq (both package.json and manifest.json)
    TMP_FILE=$(mktemp)
    jq --arg v "$NEW_CHROME_EXT_VERSION" '.version = $v' "$CHROME_EXT_PACKAGE" > "$TMP_FILE" && mv "$TMP_FILE" "$CHROME_EXT_PACKAGE"
    TMP_FILE=$(mktemp)
    jq --arg v "$NEW_CHROME_EXT_VERSION" '.version = $v' "$CHROME_EXT_MANIFEST" > "$TMP_FILE" && mv "$TMP_FILE" "$CHROME_EXT_MANIFEST"
  fi
else
  printf "  %-12s: %s\n" "Chrome Ext" "no changes in packages/chrome-extension (skipping)"
fi

echo "Done."
