#!/bin/sh
# ---------------------------------------------------------------------------
# applyCiVersionFromSha.sh — CI version stamping for all deploy workflows
# ---------------------------------------------------------------------------
#
# PURPOSE
#   Derives deterministic, monotonically-increasing version numbers from the
#   git commit history and optionally patches platform-specific build files
#   so every CI artifact is traceable back to its source commit.
#
# HOW IT WORKS
#   1. Takes a source SHA (defaults to HEAD).
#   2. Counts first-parent commits (`git rev-list --first-parent --count`)
#      to produce a SERIAL number that only increases on the main line.
#   3. Maps the serial into platform version strings:
#        CLIENT_VERSION      = 0.0.<serial>      (package.json)
#        ANDROID_VERSION_CODE = <serial>          (build.gradle versionCode)
#        ANDROID_VERSION_NAME = 1.0.<serial>      (build.gradle versionName)
#        IOS_BUILD_NUMBER     = <serial>          (Xcode CURRENT_PROJECT_VERSION)
#   4. With --apply, patches those values into the source tree in-place.
#   5. With --github-output, writes them into $GITHUB_OUTPUT for downstream
#      workflow steps.
#
# CALLERS (as of 2026-02-24) — DO NOT DELETE without updating these:
#   .github/workflows/deploy-desktop.yml            (lines ~47, ~178)
#   .github/workflows/deploy-android-matrix.yml     (line  ~158)
#   .github/workflows/deploy-android-play-store.yml (line  ~194)
#   .github/workflows/deploy-ios-testflight.yml     (line  ~191)
#   .github/workflows/deploy-ios-matrix.yml         (line  ~150)
#
# NOTE: callers live in .github/workflows/ (a dotfile directory). Standard
# grep patterns may miss them—always include dotfiles when auditing usage.
# ---------------------------------------------------------------------------
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
  trap 'rm -f "$TMP_FILE"' EXIT
  if ! jq --arg v "$CLIENT_VERSION" '.version = $v' "$CLIENT_PACKAGE_JSON" > "$TMP_FILE"; then
    exit 1
  fi
  mv "$TMP_FILE" "$CLIENT_PACKAGE_JSON"

  sedi "s/versionCode [0-9][0-9]*/versionCode $ANDROID_VERSION_CODE/" "$ANDROID_GRADLE"
  sedi "s/versionName \"[^\"]*\"/versionName \"$ANDROID_VERSION_NAME\"/" "$ANDROID_GRADLE"
  sedi "s/CURRENT_PROJECT_VERSION = [0-9][0-9]*/CURRENT_PROJECT_VERSION = $IOS_BUILD_NUMBER/g" "$IOS_PROJECT"
fi

OUTPUT="source_sha=$SOURCE_SHA
serial=$SERIAL
client_version=$CLIENT_VERSION
android_version_code=$ANDROID_VERSION_CODE
android_version_name=$ANDROID_VERSION_NAME
ios_build_number=$IOS_BUILD_NUMBER"

echo "$OUTPUT"

if [ -n "$GITHUB_OUTPUT_PATH" ]; then
  echo "$OUTPUT" >> "$GITHUB_OUTPUT_PATH"
fi
