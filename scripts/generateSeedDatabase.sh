#!/bin/sh
set -e

# Regenerate the screenshot seed backup artifact (tearleads-seed.tlbackup.json
# at the repo root) by driving the real client-sdk write path headlessly. On
# success it prints the artifact's absolute path plus the passphrase and password
# the encrypted backup is bound to, so it can be restored by hand through the
# app's Backup / Restore mini-app — outside the Playwright screenshot run.
#
# The artifact is gitignored (its bytes are non-deterministic) and lives at the
# root for easy access; the Playwright run regenerates it the same way.

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)" || exit 1
cd "$SCRIPT_DIR/.." || exit 1

bun run screenshots:seed
