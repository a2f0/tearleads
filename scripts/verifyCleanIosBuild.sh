#!/bin/sh
# Cleans up expected build-time mutations and verifies the git workspace is clean.
set -e
SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)

PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PROJECT_FILE="$PROJECT_ROOT/packages/client/ios/App/App.xcodeproj/project.pbxproj"
INFO_PLIST="$PROJECT_ROOT/packages/client/ios/App/App/Info.plist"
ANDROID_BUILD_GRADLE="$PROJECT_ROOT/packages/client/android/app/build.gradle"
CLIENT_PACKAGE_JSON="$PROJECT_ROOT/packages/client/package.json"

# Restore CFBundleVersion variable in Info.plist (may be replaced with actual number during build)
# shellcheck disable=SC2016 # $(CURRENT_PROJECT_VERSION) is an Xcode variable, not a shell variable
sed -i '' '/<key>CFBundleVersion<\/key>/{n;s/<string>[0-9]*<\/string>/<string>$(CURRENT_PROJECT_VERSION)<\/string>/;}' "$INFO_PLIST"

# Reset expected version-file mutations from applyCiVersionFromSha/build stamping.
git -C "$PROJECT_ROOT" checkout -- \
  "${ANDROID_BUILD_GRADLE#"$PROJECT_ROOT"/}" \
  "${PROJECT_FILE#"$PROJECT_ROOT"/}" \
  "${CLIENT_PACKAGE_JSON#"$PROJECT_ROOT"/}"

# Verify workspace is clean after cleanup
if [ -n "$(git -C "$PROJECT_ROOT" status --porcelain)" ]; then
  echo "Error: Workspace has unexpected changes after build cleanup"
  git -C "$PROJECT_ROOT" status
  git -C "$PROJECT_ROOT" diff
  exit 1
fi

echo "Verified: workspace is clean after build"
