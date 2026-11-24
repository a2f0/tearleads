# shellcheck shell=sh
# The shared secrets store. Not executable on its own: source it.
#
#   . "$REPO_ROOT/scripts/lib/secretsStore.sh"
#   secrets_store_link "$REPO_ROOT"
#
# A clone's gitignored .secrets links to this project's folder in
# matrix-secrets, which the a2f0/matrix workspace keeps for every clone on this
# machine (see docs/developer/infrastructure.md). POSIX sh throughout: callers
# run under /bin/sh.

# The project folder this repository reads inside matrix-secrets.
SECRETS_STORE_PROJECT=tearleads

# Prints the link target for the clone at $1 the way matrix's secrets guide
# writes it: $MATRIX_SECRETS_DIR/<project> when that variable is set (a relative
# value resolves against the clone, whatever directory the caller is in), else
# matrix-secrets beside the matrix workspace for one of its checkouts/<name>,
# else matrix-secrets beside the clone. The last two stay relative, like the
# links in other clones. Fails when MATRIX_SECRETS_DIR names no folder.
secrets_store_target() {
  if [ -n "${MATRIX_SECRETS_DIR:-}" ]; then
    case "$MATRIX_SECRETS_DIR" in
      /*) secrets_store_root=$MATRIX_SECRETS_DIR ;;
      *) secrets_store_root=$1/$MATRIX_SECRETS_DIR ;;
    esac
    secrets_store_root=$(CDPATH='' cd -- "$secrets_store_root" 2>/dev/null && pwd -P) || return 1
    printf '%s/%s\n' "$secrets_store_root" "$SECRETS_STORE_PROJECT"
    return 0
  fi
  secrets_store_parent=$(CDPATH='' cd -- "$1/.." && pwd -P) || return 1
  if [ "${secrets_store_parent##*/}" = checkouts ] && [ -f "$secrets_store_parent/../matrix.json" ]; then
    printf '../../../matrix-secrets/%s\n' "$SECRETS_STORE_PROJECT"
  else
    printf '../matrix-secrets/%s\n' "$SECRETS_STORE_PROJECT"
  fi
}

# Links the clone at $1 to its secrets folder when it has no .secrets at all and
# the folder exists, so a release or native build from a fresh clone or worktree
# reads the shared signing keys and store credentials. A clone that already
# holds a .secrets, a link included, is left alone. Outside a Git checkout it
# does nothing; without the folder (CI, or a machine without matrix) it warns.
# It never fails its caller.
secrets_store_link() {
  if [ -e "$1/.secrets" ] || [ -L "$1/.secrets" ] || [ ! -e "$1/.git" ]; then
    return 0
  fi
  secrets_store_link_target=$(secrets_store_target "$1") || secrets_store_link_target=""
  case "$secrets_store_link_target" in
    "") secrets_store_link_folder="" ;;
    /*) secrets_store_link_folder=$secrets_store_link_target ;;
    *) secrets_store_link_folder=$1/$secrets_store_link_target ;;
  esac
  if [ -z "$secrets_store_link_folder" ] || [ ! -d "$secrets_store_link_folder" ]; then
    echo "warning: no matrix-secrets/$SECRETS_STORE_PROJECT folder found, so .secrets stays unlinked" >&2
    return 0
  fi
  if ln -s "$secrets_store_link_target" "$1/.secrets"; then
    echo "Linked .secrets to $secrets_store_link_target"
  else
    echo "warning: could not link .secrets to $secrets_store_link_target" >&2
  fi
  return 0
}
