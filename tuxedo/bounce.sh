#!/bin/sh
# Bounce tuxedo - kill tmux session but keep screen sessions alive
# Screen sessions survive and will be reattached on restart

set -eu

SESSION_NAME="tuxedo"

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "Killing tmux session '$SESSION_NAME'..."
    tmux kill-session -t "$SESSION_NAME"
    echo "Session killed. Screen sessions preserved."
else
    echo "No tmux session '$SESSION_NAME' found."
fi

echo "Restarting tuxedo..."
SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd -P)
exec "$SCRIPT_DIR/tuxedo.sh"
