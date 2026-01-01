#!/bin/sh
# Configurable via environment variables
BASE_DIR="${TUXEDO_BASE_DIR:-$HOME/github}"
EDITOR="${TUXEDO_EDITOR:-nvim}"
NUM_WORKSPACES="${TUXEDO_WORKSPACES:-20}"
SESSION_NAME="tuxedo"

# To detach - tmux detach
# To destroy - tmux kill-session

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    tmux attach-session -t "$SESSION_NAME"
    exit 0
fi

tmux new-session -d -s "$SESSION_NAME" -c "$BASE_DIR/rapid-main" -n rapid-main
tmux split-window -h -t "$SESSION_NAME:rapid-main" -c "$BASE_DIR/rapid-main" "$EDITOR"

i=2
while [ "$i" -le "$NUM_WORKSPACES" ]; do
    tmux new-window -t "$SESSION_NAME" -c "$BASE_DIR/rapid${i}" -n "rapid${i}"
    tmux split-window -h -t "$SESSION_NAME:rapid${i}" -c "$BASE_DIR/rapid${i}" "$EDITOR"
    i=$((i + 1))
done

# Enable mouse support for this session only (not globally)
tmux set-option -t "$SESSION_NAME" mouse on

tmux select-window -t "$SESSION_NAME:0"
tmux attach-session -t "$SESSION_NAME"
