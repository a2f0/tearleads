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

# Copying alone leaves a hook that was deleted or renamed in the source tree
# installed and executable, so it keeps running forever. Mirror the deletion.
# Git's own *.sample files ship with `git init`, are inert, and are left alone.
for installed in "$HOOKS_DST"/*; do
  [ -f "$installed" ] || continue
  installed_name="$(basename "$installed")"
  case "$installed_name" in
    *.sample) continue ;;
  esac
  if [ ! -f "$HOOKS_SRC/$installed_name" ]; then
    rm -f "$installed"
    echo "Removed stale $installed_name hook"
  fi
done

git config core.hooksPath "$HOOKS_DST"
echo "Configured core.hooksPath to $HOOKS_DST"
