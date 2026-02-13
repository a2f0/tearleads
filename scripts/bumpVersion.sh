#!/bin/sh
set -eu

REPO_ROOT="$(git rev-parse --show-toplevel)"
BASE_BRANCH="${BASE_BRANCH:-main}"
CHANGED_FILES_FILE="${CHANGED_FILES_FILE:-}"
DRY_RUN=false

if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=true
fi

sedi() {
  if [ "$(uname)" = "Darwin" ]; then
    sed -i '' "$@"
  else
    sed -i "$@"
  fi
}

CLIENT_ANDROID_REL="packages/client/android/app/build.gradle"
CLIENT_IOS_REL="packages/client/ios/App/App.xcodeproj/project.pbxproj"
CHROME_EXT_MANIFEST_REL="packages/chrome-extension/public/manifest.json"
CLIENT_ANDROID="$REPO_ROOT/$CLIENT_ANDROID_REL"
CLIENT_IOS="$REPO_ROOT/$CLIENT_IOS_REL"
CHROME_EXT_MANIFEST="$REPO_ROOT/$CHROME_EXT_MANIFEST_REL"

CLIENT_CHANGED=false
CLIENT_NEW_VERSION=""

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
  VERSION_FILES="$2"

  if [ -n "$CHANGED_FILES_FILE" ]; then
    if [ ! -f "$CHANGED_FILES_FILE" ] || [ ! -r "$CHANGED_FILES_FILE" ]; then
      echo "Error: CHANGED_FILES_FILE is not a readable file: $CHANGED_FILES_FILE" >&2
      exit 1
    fi
    CHANGED_FILES=$(grep -E "^${TARGET_DIR}(/|$)" "$CHANGED_FILES_FILE" || true)
  else
    CHANGED_FILES=$(git diff --name-only "$BASE_BRANCH"...HEAD -- "$TARGET_DIR")
  fi

  if [ -z "$CHANGED_FILES" ]; then
    return 1
  fi

  OLD_IFS="$IFS"
  IFS='
'
  for FILE_PATH in $CHANGED_FILES; do
    SHOULD_IGNORE=false
    for VERSION_FILE in $VERSION_FILES; do
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

list_package_dirs() {
  find "$REPO_ROOT/packages" -mindepth 1 -maxdepth 1 -type d | while read -r ABS_PACKAGE_DIR; do
    if [ -f "$ABS_PACKAGE_DIR/package.json" ]; then
      echo "${ABS_PACKAGE_DIR#"$REPO_ROOT"/}"
    fi
  done | sort
}

version_files_for_package() {
  PACKAGE_DIR="$1"

  case "$PACKAGE_DIR" in
    packages/client)
      echo "$PACKAGE_DIR/package.json $CLIENT_ANDROID_REL $CLIENT_IOS_REL"
      ;;
    packages/chrome-extension)
      echo "$PACKAGE_DIR/package.json $CHROME_EXT_MANIFEST_REL"
      ;;
    *)
      echo "$PACKAGE_DIR/package.json"
      ;;
  esac
}

bump_npm_package_version() {
  PKG_LABEL="$1"
  PKG_PATH="$2"
  PKG_CHANGED="$3"
  PKG_DIR_NAME=$(basename "$(dirname "$PKG_PATH")")

  if [ "$PKG_CHANGED" != "true" ]; then
    printf "  %-16s: %s\n" "$PKG_LABEL" "no changes in packages/$PKG_DIR_NAME (skipping)"
    return
  fi

  CURRENT_VERSION=$(jq -r '.version' "$PKG_PATH")
  MAJOR=$(echo "$CURRENT_VERSION" | cut -d. -f1)
  MINOR=$(echo "$CURRENT_VERSION" | cut -d. -f2)
  PATCH=$(echo "$CURRENT_VERSION" | cut -d. -f3)
  NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"

  printf "  %-16s: %s -> %s\n" "$PKG_LABEL" "$CURRENT_VERSION" "$NEW_VERSION"

  if [ "$DRY_RUN" = "true" ]; then
    printf "  (dry-run) Update %s version\n" "$PKG_PATH"
  else
    TMP_FILE=$(mktemp)
    jq --arg v "$NEW_VERSION" '.version = $v' "$PKG_PATH" > "$TMP_FILE" && mv "$TMP_FILE" "$PKG_PATH"
  fi
}

bump_client_package_version() {
  CLIENT_PACKAGE="$1"
  PKG_CHANGED="$2"

  if [ "$PKG_CHANGED" != "true" ]; then
    printf "  %-16s: %s\n" "client" "no changes in packages/client (skipping)"
    return
  fi

  CLIENT_CHANGED=true

  ANDROID_VERSION=$(grep -E 'versionCode [0-9]+' "$CLIENT_ANDROID" | head -1 | sed 's/.*versionCode \([0-9]*\).*/\1/')
  NEW_ANDROID_VERSION=$((ANDROID_VERSION + 1))

  ANDROID_VERSION_NAME=$(grep -E 'versionName "[^"]+"' "$CLIENT_ANDROID" | head -1 | sed 's/.*versionName "\([^"]*\)".*/\1/')
  ANDROID_VERSION_PREFIX=$(echo "$ANDROID_VERSION_NAME" | sed 's/\.[0-9]*$//')
  NEW_ANDROID_VERSION_NAME="$ANDROID_VERSION_PREFIX.$NEW_ANDROID_VERSION"

  IOS_VERSION=$(grep -E 'CURRENT_PROJECT_VERSION = [0-9]+' "$CLIENT_IOS" | head -1 | sed 's/.*= \([0-9]*\).*/\1/')
  NEW_IOS_VERSION=$((IOS_VERSION + 1))

  CLIENT_VERSION=$(jq -r '.version' "$CLIENT_PACKAGE")
  CLIENT_MAJOR=$(echo "$CLIENT_VERSION" | cut -d. -f1)
  CLIENT_MINOR=$(echo "$CLIENT_VERSION" | cut -d. -f2)
  CLIENT_PATCH=$(echo "$CLIENT_VERSION" | cut -d. -f3)
  NEW_CLIENT_PATCH=$((CLIENT_PATCH + 1))
  NEW_CLIENT_VERSION="$CLIENT_MAJOR.$CLIENT_MINOR.$NEW_CLIENT_PATCH"
  CLIENT_NEW_VERSION="$NEW_CLIENT_VERSION"

  printf "  %-16s: %s -> %s\n" "client/android" "$ANDROID_VERSION" "$NEW_ANDROID_VERSION"
  printf "  %-16s: %s -> %s\n" "client/ios" "$IOS_VERSION" "$NEW_IOS_VERSION"
  printf "  %-16s: %s -> %s\n" "client" "$CLIENT_VERSION" "$NEW_CLIENT_VERSION"

  if [ "$DRY_RUN" = "true" ]; then
    printf "  (dry-run) Update Android versionCode/versionName\n"
    printf "  (dry-run) Update iOS CURRENT_PROJECT_VERSION\n"
    printf "  (dry-run) Update packages/client/package.json version\n"
  else
    sedi "s/versionCode $ANDROID_VERSION/versionCode $NEW_ANDROID_VERSION/" "$CLIENT_ANDROID"
    sedi "s/versionName \"$ANDROID_VERSION_NAME\"/versionName \"$NEW_ANDROID_VERSION_NAME\"/" "$CLIENT_ANDROID"

    sedi "s/CURRENT_PROJECT_VERSION = $IOS_VERSION/CURRENT_PROJECT_VERSION = $NEW_IOS_VERSION/g" "$CLIENT_IOS"

    TMP_FILE=$(mktemp)
    jq --arg v "$NEW_CLIENT_VERSION" '.version = $v' "$CLIENT_PACKAGE" > "$TMP_FILE" && mv "$TMP_FILE" "$CLIENT_PACKAGE"
  fi
}

bump_chrome_extension_version() {
  CHROME_EXT_PACKAGE="$1"
  PKG_CHANGED="$2"

  if [ "$PKG_CHANGED" != "true" ]; then
    printf "  %-16s: %s\n" "chrome-extension" "no changes in packages/chrome-extension (skipping)"
    return
  fi

  CHROME_EXT_VERSION=$(jq -r '.version' "$CHROME_EXT_PACKAGE")
  CHROME_EXT_MAJOR=$(echo "$CHROME_EXT_VERSION" | cut -d. -f1)
  CHROME_EXT_MINOR=$(echo "$CHROME_EXT_VERSION" | cut -d. -f2)
  CHROME_EXT_PATCH=$(echo "$CHROME_EXT_VERSION" | cut -d. -f3)
  NEW_CHROME_EXT_PATCH=$((CHROME_EXT_PATCH + 1))
  NEW_CHROME_EXT_VERSION="$CHROME_EXT_MAJOR.$CHROME_EXT_MINOR.$NEW_CHROME_EXT_PATCH"

  printf "  %-16s: %s -> %s\n" "chrome-extension" "$CHROME_EXT_VERSION" "$NEW_CHROME_EXT_VERSION"

  if [ "$DRY_RUN" = "true" ]; then
    printf "  (dry-run) Update packages/chrome-extension/package.json version\n"
    printf "  (dry-run) Update packages/chrome-extension/public/manifest.json version\n"
  else
    TMP_FILE=$(mktemp)
    jq --arg v "$NEW_CHROME_EXT_VERSION" '.version = $v' "$CHROME_EXT_PACKAGE" > "$TMP_FILE" && mv "$TMP_FILE" "$CHROME_EXT_PACKAGE"
    TMP_FILE=$(mktemp)
    jq --arg v "$NEW_CHROME_EXT_VERSION" '.version = $v' "$CHROME_EXT_MANIFEST" > "$TMP_FILE" && mv "$TMP_FILE" "$CHROME_EXT_MANIFEST"
  fi
}

printf "Bumping versions (base: %s):\n" "$BASE_BRANCH"

for PACKAGE_DIR in $(list_package_dirs); do
  PACKAGE_NAME="${PACKAGE_DIR#packages/}"
  PACKAGE_JSON="$REPO_ROOT/$PACKAGE_DIR/package.json"
  VERSION_FILES="$(version_files_for_package "$PACKAGE_DIR")"

  if has_changes "$PACKAGE_DIR" "$VERSION_FILES"; then
    PACKAGE_CHANGED=true
  else
    PACKAGE_CHANGED=false
  fi

  case "$PACKAGE_NAME" in
    client)
      bump_client_package_version "$PACKAGE_JSON" "$PACKAGE_CHANGED"
      ;;
    chrome-extension)
      bump_chrome_extension_version "$PACKAGE_JSON" "$PACKAGE_CHANGED"
      ;;
    *)
      bump_npm_package_version "$PACKAGE_NAME" "$PACKAGE_JSON" "$PACKAGE_CHANGED"
      ;;
  esac
done

RELEASES_FILE="$REPO_ROOT/packages/website/src/data/releases.json"
if [ "$CLIENT_CHANGED" = "true" ] && [ -n "$CLIENT_NEW_VERSION" ] && [ -f "$RELEASES_FILE" ]; then
  CURRENT_DATE=$(date +%Y-%m-%d)

  if jq -e ".releases[] | select(.version == \"$CLIENT_NEW_VERSION\")" "$RELEASES_FILE" > /dev/null 2>&1; then
    printf "  %-16s: %s\n" "releases" "version $CLIENT_NEW_VERSION already in releases.json (skipping)"
  else
    if [ "$DRY_RUN" = "true" ]; then
      printf "  %-16s: %s\n" "releases" "would add $CLIENT_NEW_VERSION to releases.json"
    else
      TMP_FILE=$(mktemp)
      jq --arg ver "$CLIENT_NEW_VERSION" \
         --arg date "$CURRENT_DATE" \
         '.releases = [{
           "version": $ver,
           "date": $date,
           "platforms": {
             "macos": { "arch": "arm64", "ext": "dmg" },
             "windows": { "arch": "x64", "ext": "exe" },
             "linux": { "arch": "x64", "ext": "AppImage" }
           }
         }] + .releases' "$RELEASES_FILE" > "$TMP_FILE" && mv "$TMP_FILE" "$RELEASES_FILE"
      printf "  %-16s: %s\n" "releases" "added $CLIENT_NEW_VERSION to releases.json"
    fi
  fi
fi

echo "Done."
