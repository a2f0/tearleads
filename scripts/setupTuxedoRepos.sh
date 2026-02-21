#!/bin/sh
set -eu

BASE_DIR="${TUXEDO_BASE_DIR:-$HOME/tuxedo}"
# Workspace naming matches tuxedo-lib.sh defaults (tearleads-main, tearleads2, etc.)
WORKSPACE_PREFIX="${TUXEDO_WORKSPACE_PREFIX:-tearleads}"
WORKSPACE_START="${TUXEDO_WORKSPACE_START:-2}"
REPO_SSH_URL="${TUXEDO_REPO_SSH_URL:-git@github.com:a2f0/tearleads.git}"
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

clone_or_update "$BASE_DIR/${WORKSPACE_PREFIX}-main"
clone_or_update "$BASE_DIR/${WORKSPACE_PREFIX}-shared"

i=$WORKSPACE_START
while [ "$i" -le "$WORKSPACE_COUNT" ]; do
  clone_or_update "$BASE_DIR/${WORKSPACE_PREFIX}${i}"
  i=$((i + 1))
done
