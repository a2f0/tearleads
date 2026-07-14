#!/bin/sh
set -e

# Regenerate the screenshot seed backup artifact
# (packages/app/test/screenshot-seed/fixtures/tearleads-seed.tlbackup.json) by
# driving the real client-sdk write path headlessly. On success it prints the
# artifact's absolute path plus the passphrase and password the encrypted backup
# is bound to, so it can be restored by hand through the app's Backup / Restore
# mini-app — outside the Playwright screenshot run.
#
# Note: the backup bytes differ on every run (random ids + encryption nonces),
# so this leaves the committed artifact modified in git even when the seed data
# is unchanged; revert it with `git checkout` if you only wanted the path.

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)" || exit 1
cd "$SCRIPT_DIR/.." || exit 1

bun run screenshots:seed
