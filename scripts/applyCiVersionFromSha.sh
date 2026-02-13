#!/bin/sh
set -eu

REPO_ROOT="$(git rev-parse --show-toplevel)"
SOURCE_SHA=""
APPLY=false
GITHUB_OUTPUT_PATH=""

usage() {
  cat <<'EOF'
Usage: scripts/applyCiVersionFromSha.sh [options]

Options:
  --source-sha <sha>         Source commit SHA to derive the serial from (default: HEAD)
  --apply                    Apply computed versions to client files
  --github-output <path>     Append computed values to a GitHub Actions output file
  -h, --help                 Show help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --source-sha)
      if [ $# -lt 2 ]; then
        echo "Missing value for --source-sha" >&2
        exit 1
      fi
      SOURCE_SHA="$2"
      shift 2
      ;;
    --apply)
      APPLY=true
      shift
      ;;
    --github-output)
      if [ $# -lt 2 ]; then
        echo "Missing value for --github-output" >&2
        exit 1
      fi
      GITHUB_OUTPUT_PATH="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [ -z "$SOURCE_SHA" ]; then
  SOURCE_SHA="$(git rev-parse HEAD)"
fi

if ! git rev-parse --verify "$SOURCE_SHA^{commit}" >/dev/null 2>&1; then
  echo "Source SHA is not a valid commit: $SOURCE_SHA" >&2
  exit 1
fi

SERIAL="$(git rev-list --first-parent --count "$SOURCE_SHA")"
if [ "$SERIAL" -le 0 ] 2>/dev/null; then
  echo "Computed invalid serial: $SERIAL" >&2
  exit 1
fi

CLIENT_VERSION="0.0.$SERIAL"
ANDROID_VERSION_CODE="$SERIAL"
ANDROID_VERSION_NAME="1.0.$SERIAL"
IOS_BUILD_NUMBER="$SERIAL"

sedi() {
  if [ "$(uname)" = "Darwin" ]; then
    sed -i '' "$@"
  else
    sed -i "$@"
  fi
}

if [ "$APPLY" = "true" ]; then
  CLIENT_PACKAGE_JSON="$REPO_ROOT/packages/client/package.json"
  ANDROID_GRADLE="$REPO_ROOT/packages/client/android/app/build.gradle"
  IOS_PROJECT="$REPO_ROOT/packages/client/ios/App/App.xcodeproj/project.pbxproj"

  TMP_FILE="$(mktemp)"
  jq --arg v "$CLIENT_VERSION" '.version = $v' "$CLIENT_PACKAGE_JSON" > "$TMP_FILE" && mv "$TMP_FILE" "$CLIENT_PACKAGE_JSON"

  CURRENT_ANDROID_CODE="$(grep -E 'versionCode [0-9]+' "$ANDROID_GRADLE" | head -1 | sed -E 's/.*versionCode ([0-9]+).*/\1/')"
  CURRENT_ANDROID_NAME="$(grep -E 'versionName "[^"]+"' "$ANDROID_GRADLE" | head -1 | sed -E 's/.*versionName "([^"]+)".*/\1/')"

  sedi "s/versionCode $CURRENT_ANDROID_CODE/versionCode $ANDROID_VERSION_CODE/" "$ANDROID_GRADLE"
  sedi "s/versionName \"$CURRENT_ANDROID_NAME\"/versionName \"$ANDROID_VERSION_NAME\"/" "$ANDROID_GRADLE"
  sedi "s/CURRENT_PROJECT_VERSION = [0-9]\\+/CURRENT_PROJECT_VERSION = $IOS_BUILD_NUMBER/g" "$IOS_PROJECT"
fi

echo "source_sha=$SOURCE_SHA"
echo "serial=$SERIAL"
echo "client_version=$CLIENT_VERSION"
echo "android_version_code=$ANDROID_VERSION_CODE"
echo "android_version_name=$ANDROID_VERSION_NAME"
echo "ios_build_number=$IOS_BUILD_NUMBER"

if [ -n "$GITHUB_OUTPUT_PATH" ]; then
  {
    echo "source_sha=$SOURCE_SHA"
    echo "serial=$SERIAL"
    echo "client_version=$CLIENT_VERSION"
    echo "android_version_code=$ANDROID_VERSION_CODE"
    echo "android_version_name=$ANDROID_VERSION_NAME"
    echo "ios_build_number=$IOS_BUILD_NUMBER"
  } >> "$GITHUB_OUTPUT_PATH"
fi
