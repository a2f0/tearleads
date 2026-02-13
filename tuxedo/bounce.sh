#!/bin/sh
# Bounce tuxedo - kill tmux server and restart fresh
# Screen sessions survive and will be reattached on restart
#
# Why kill the server? tmux caches config at server level. Killing just the
# session doesn't reload config changes (like automatic-rename settings).

set -eu

echo "Killing tmux server (screen sessions will survive)..."
tmux kill-server 2>/dev/null || true

echo "Restarting tuxedo..."
SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd -P)
exec "$SCRIPT_DIR/tuxedo.sh"
