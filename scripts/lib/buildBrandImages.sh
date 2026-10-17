#!/bin/sh
# Renders brand image targets from assets/brand/*.svg with the pinned agent-tool,
# as the `images` section of agent-tool.json declares them. Outputs are
# gitignored build artifacts.
#
# Usage: sh scripts/lib/buildBrandImages.sh <target>...
#
# Gradle, fastlane, and the desktop release scripts call this with whatever PATH
# their host gave them, which for an IDE is often minimal. agent-tool runs on
# Bun, so the usual Bun locations are appended after the caller's own PATH.
set -eu

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 <target>..." >&2
  exit 2
fi

REPO_ROOT="$(CDPATH='' cd -P -- "$(dirname -- "$0")/../.." && pwd -P)"
AGENT_TOOL="$REPO_ROOT/node_modules/.bin/agent-tool"

PATH="${PATH:-/usr/bin:/bin}"
if [ -n "${HOME:-}" ]; then
  PATH="$PATH:$HOME/.bun/bin:$HOME/.local/share/mise/shims"
fi
PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
export PATH

if [ ! -e "$AGENT_TOOL" ]; then
  echo "Error: $AGENT_TOOL not found; run 'bun install' in $REPO_ROOT first." >&2
  exit 1
fi
if ! command -v bun > /dev/null 2>&1; then
  echo "Error: Bun is required to render brand images but is not on PATH." >&2
  exit 1
fi

exec "$AGENT_TOOL" --repo "$REPO_ROOT" images build "$@"
