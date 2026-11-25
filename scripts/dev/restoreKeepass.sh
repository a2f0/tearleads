#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/dev/restoreKeepass.sh <dev|staging|prod> <file.kdbx> [options]

Logs the `tearleads` CLI in to a tier and restores a KeePass database into
the account as a new folder of passcodes, from a fresh shell. dev is the local
API (scripts/dev/runApi.sh) at http://localhost:3001; staging and prod are the
deployed APIs. The account must already exist on that tier.

Options pass through to `tearleads restore-keepass`, which always runs with
--trace (timestamped progress on stderr; it can include folder names):
  --name <folder>     Name the restore folder (default: the database's name)
  --key-file <path>   The database's key file, if it has one

The CLI asks for the account's recovery key, then the database's master
password; neither echoes. Each run makes a new folder, so running it again
restores a second copy rather than updating the first.

The CLI keeps its recovery key in the macOS login Keychain, which is locked
in a shell that is not part of the desktop session (SSH, tmux, screen).
`security` prompts for the macOS login password; other platforms have no
login Keychain, so the unlock is skipped there.
EOF
}

# The CLI runs from packages/cli, so paths given from here must be absolute.
absolute() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s/%s\n' "$PWD" "$1" ;;
  esac
}

require_readable() {
  if [ ! -f "$1" ] || [ ! -r "$1" ]; then
    echo "Cannot read $1." >&2
    exit 1
  fi
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi
if [ "$#" -lt 2 ]; then
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
file=$(absolute "$2")
require_readable "$file"
shift 2

# Rebuild the options in place, making a key file path absolute. Checked
# before the Keychain prompt and the build, so a typo costs nothing.
remaining=$#
while [ "$remaining" -gt 0 ]; do
  option=$1
  shift
  remaining=$((remaining - 1))
  case "$option" in
    --key-file)
      if [ "$remaining" -eq 0 ]; then
        echo "--key-file needs a path." >&2
        exit 1
      fi
      key_file=$(absolute "$1")
      shift
      remaining=$((remaining - 1))
      require_readable "$key_file"
      set -- "$@" --key-file "$key_file"
      ;;
    --key-file=*)
      key_file=$(absolute "${option#--key-file=}")
      require_readable "$key_file"
      set -- "$@" "--key-file=$key_file"
      ;;
    --env | --env=* | --api-url | --api-url=* | --key-stdin)
      echo "$option does not apply: the tier argument picks the API." >&2
      exit 1
      ;;
    *) set -- "$@" "$option" ;;
  esac
done

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
bun run tearleads restore-keepass "$file" --env "$target" --trace "$@"
