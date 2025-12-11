#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PROJECT_FILE="$PROJECT_ROOT/packages/client/ios/App/App.xcodeproj/project.pbxproj"
INFO_PLIST="$PROJECT_ROOT/packages/client/ios/App/App/Info.plist"

# Clear DEVELOPMENT_TEAM from project file
sed -i '' '/DEVELOPMENT_TEAM = /d' "$PROJECT_FILE"

# Restore CFBundleVersion variable in Info.plist
# shellcheck disable=SC2016 # $(CURRENT_PROJECT_VERSION) is an Xcode variable, not a shell variable
sed -i '' '/<key>CFBundleVersion<\/key>/{n;s/<string>[0-9]*<\/string>/<string>$(CURRENT_PROJECT_VERSION)<\/string>/;}' "$INFO_PLIST"

# Check if any files other than project.pbxproj were modified
MODIFIED_FILES=$(git -C "$PROJECT_ROOT" status --porcelain | grep -v -F ' M packages/client/ios/App/App.xcodeproj/project.pbxproj' || true)

if [[ -n "$MODIFIED_FILES" ]]; then
  echo "Error: Unexpected files changed after deployment"
  echo "$MODIFIED_FILES"
  git -C "$PROJECT_ROOT" diff
  exit 1
fi

# Verify project.pbxproj was actually modified
if git -C "$PROJECT_ROOT" diff --quiet "$PROJECT_FILE"; then
  echo "Error: No changes found in project.pbxproj"
  exit 1
fi

# Get just the changed lines (skip 4 header lines: diff, index, ---, +++)
DIFF_LINES=$(git -C "$PROJECT_ROOT" diff -U0 "$PROJECT_FILE" | tail -n +5)

echo "Changes to commit:"
echo "$DIFF_LINES"

# Verify only CURRENT_PROJECT_VERSION changed
TOTAL_CHANGES=$(echo "$DIFF_LINES" | grep -c '^[-+]' || true)
VERSION_CHANGES=$(echo "$DIFF_LINES" | grep -c 'CURRENT_PROJECT_VERSION' || true)

if [[ "$TOTAL_CHANGES" -eq 0 ]] || [[ "$VERSION_CHANGES" -eq 0 ]]; then
  echo "Error: No CURRENT_PROJECT_VERSION changes found"
  exit 1
fi

if [[ "$TOTAL_CHANGES" -ne "$VERSION_CHANGES" ]]; then
  echo "Error: Found changes other than CURRENT_PROJECT_VERSION"
  echo "Total changed lines: $TOTAL_CHANGES"
  echo "CURRENT_PROJECT_VERSION lines: $VERSION_CHANGES"
  echo "$DIFF_LINES" | grep -v 'CURRENT_PROJECT_VERSION'
  exit 1
fi

echo "Verified: only CURRENT_PROJECT_VERSION changed ($VERSION_CHANGES lines)"
