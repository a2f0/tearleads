#!/bin/sh
set -eu

# Log the `tearleads` CLI in to production and seed it, from a fresh shell.
#
# The CLI keeps its recovery key in the macOS login Keychain, which is locked
# in a shell that is not part of the desktop session (SSH, tmux, screen).
# `security` prompts for the macOS login password; other platforms have no
# login Keychain, so the unlock is skipped there.

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
cd "$SCRIPT_DIR/../.." || exit 1

if [ "$(uname -s)" = "Darwin" ]; then
  security unlock-keychain
else
  echo "Not macOS; skipping the login Keychain unlock."
fi

bun install
bun run build:runtime
bun run tearleads login --env production
bun run tearleads seed --env production --trace
