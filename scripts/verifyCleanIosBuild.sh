#!/bin/bash
# Cleans up iOS build artifacts that fastlane/Xcode modifies during builds:
# - Removes DEVELOPMENT_TEAM entries from project.pbxproj
# - Restores CFBundleVersion placeholder in Info.plist
# Then verifies the git workspace is clean (no uncommitted changes).
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

# Clear DEVELOPMENT_TEAM from project file (added by fastlane during build)
sed -i '' '/DEVELOPMENT_TEAM = /d' "$PROJECT_FILE"

# Restore CFBundleVersion variable in Info.plist (may be replaced with actual number during build)
# shellcheck disable=SC2016 # $(CURRENT_PROJECT_VERSION) is an Xcode variable, not a shell variable
sed -i '' '/<key>CFBundleVersion<\/key>/{n;s/<string>[0-9]*<\/string>/<string>$(CURRENT_PROJECT_VERSION)<\/string>/;}' "$INFO_PLIST"

# Verify workspace is clean after cleanup
if [[ -n $(git -C "$PROJECT_ROOT" status --porcelain) ]]; then
  echo "Error: Workspace has unexpected changes after build cleanup"
  git -C "$PROJECT_ROOT" status
  git -C "$PROJECT_ROOT" diff
  exit 1
fi

echo "Verified: workspace is clean after build"
