#!/bin/sh

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_SRC="$REPO_ROOT/scripts/git/hooks"
HOOKS_DST="$REPO_ROOT/.git/hooks"

for hook in "$HOOKS_SRC"/*; do
  if [ -f "$hook" ]; then
    hook_name="$(basename "$hook")"
    cp "$hook" "$HOOKS_DST/$hook_name"
    chmod +x "$HOOKS_DST/$hook_name"
    echo "Installed $hook_name hook"
  fi
done

git config core.hooksPath "$HOOKS_DST"
echo "Configured core.hooksPath to $HOOKS_DST"
