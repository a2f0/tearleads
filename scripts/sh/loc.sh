#!/bin/sh
set -eu

# Lines of code counter using tokei (https://github.com/XAMPPRocky/tokei)
# Install: brew install tokei (macOS) or cargo install tokei

if ! command -v tokei >/dev/null 2>&1; then
  echo "Error: tokei is not installed"
  echo "Install with: brew install tokei"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$REPO_ROOT"

echo "Lines of Code Report"
echo "===================="
echo ""

tokei --sort code "$@"
