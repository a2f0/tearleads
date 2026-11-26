#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/dev/seedFromContinuity.sh <dev|staging|prod>

Logs the `tearleads` CLI in to a tier and seeds the account with the
Continuity screenshot dataset, from a fresh shell. dev is the local API
(scripts/dev/runApi.sh) at http://localhost:3001; staging and prod are the
deployed APIs. The account must already exist on that tier.

The seed passes --roster, so it also seeds the dataset's groups: each group
member gets an account derived from yours, joins your roster, and takes a
seat in your organization. It also passes --accept-terms, which agrees to the
Tearleads Privacy Policy and Terms of Service for each member account it
creates instead of asking you to type yes.

The CLI keeps its recovery key in the macOS login Keychain, which is locked
in a shell that is not part of the desktop session (SSH, tmux, screen).
`security` prompts for the macOS login password; other platforms have no
login Keychain, so the unlock is skipped there.
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi
if [ "$#" -ne 1 ]; then
  usage >&2
  exit 1
fi

case "$1" in
  dev) target=development ;;
  staging) target=staging ;;
  prod) target=production ;;
  *)
    usage >&2
    exit 1
    ;;
esac

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
cd "$SCRIPT_DIR/../.." || exit 1

if [ "$(uname -s)" = "Darwin" ]; then
  security unlock-keychain
else
  echo "Not macOS; skipping the login Keychain unlock."
fi

bun install
bun run build:runtime
bun run tearleads login --env "$target"
bun run tearleads seed --env "$target" --roster --accept-terms --trace
