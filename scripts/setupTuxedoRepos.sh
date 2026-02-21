#!/bin/sh
set -eu

BASE_DIR="${TUXEDO_BASE_DIR:-$HOME/tuxedo}"
# Server uses github.com-tuxedo (deploy key alias); developers use github.com directly
REPO_SSH_URL="${TUXEDO_REPO_SSH_URL:-git@github.com-tuxedo:a2f0/tearleads.git}"
WORKSPACE_COUNT="${TUXEDO_WORKSPACE_COUNT:-10}"

clone_or_update() {
  dest="$1"
  if [ -d "$dest/.git" ]; then
    git -C "$dest" fetch --prune
  else
    git clone "$REPO_SSH_URL" "$dest"
  fi
}

mkdir -p "$BASE_DIR"

clone_or_update "$BASE_DIR/tuxedo-main"
clone_or_update "$BASE_DIR/tuxedo-shared"

i=1
while [ "$i" -le "$WORKSPACE_COUNT" ]; do
  clone_or_update "$BASE_DIR/tuxedo$i"
  i=$((i + 1))
done
