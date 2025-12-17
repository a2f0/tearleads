#!/bin/sh
set -eu

CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "Error: Must be on 'main' branch to release. Currently on '$CURRENT_BRANCH'."
  exit 1
fi

git fetch origin main
LOCAL_SHA=$(git rev-parse HEAD)
REMOTE_SHA=$(git rev-parse origin/main)

if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  echo "Error: Local main is not up-to-date with origin/main."
  echo "  Local:  $LOCAL_SHA"
  echo "  Remote: $REMOTE_SHA"
  echo "Please pull the latest changes first."
  exit 1
fi

pnpm lint
pnpm build
