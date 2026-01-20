#!/bin/sh
# Tuxedo - tmux session manager for rapid development
#
# Configurable via environment variables:
#   TUXEDO_BASE_DIR     - Base directory for workspaces (default: $HOME/github)
#   TUXEDO_EDITOR       - Editor command (default: uses local nvim config)
#   TUXEDO_WORKSPACES   - Number of workspaces to create (default: 20)
#
# Shared resources:
#   rapid-shared/ is the source of truth for shared directories (not version controlled).
#   CLAUDE.md is NOT symlinked since it's tracked in git.
#
# Screen session persistence:
#   Each workspace runs inside a GNU screen session. If you kill tmux,
#   the screen sessions survive. When you restart tuxedo.sh, it reattaches
#   to existing screen sessions, preserving running processes (like Claude agents).
#
# To detach: tmux detach (or Ctrl+B, D)
# To destroy: tmux kill-session -t tuxedo
# To kill screens too: screen -ls | grep tux- | cut -d. -f1 | xargs -I{} screen -X -S {} quit

set -eu
SCRIPT_PATH="${TUXEDO_SCRIPT_PATH:-$0}"
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)

. "$SCRIPT_DIR/lib/tuxedo-lib.sh"

tuxedo_init "$SCRIPT_DIR"
tuxedo_maybe_launch_ghostty "$SCRIPT_PATH" "$@"
tuxedo_main
