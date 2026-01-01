SESSION_NAME="tuxedo"
# To detach - tmux detach
# To destroy - tmux kill-session

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    tmux attach-session -t "$SESSION_NAME"
    exit 0
fi

tmux new-session -d -s "$SESSION_NAME" -c "$HOME/github/rapid-main" -n rapid-main
tmux split-window -h -t "$SESSION_NAME:rapid-main" -c "$HOME/github/rapid-main" "nvim"

i=2
while [ "$i" -le 20 ]; do
    tmux new-window -t "$SESSION_NAME" -c "$HOME/github/rapid${i}" -n "rapid${i}"
    tmux split-window -h -t "$SESSION_NAME:rapid${i}" -c "$HOME/github/rapid${i}" "nvim"
    i=$((i + 1))
done
tmux set -g mouse on
tmux select-window -t "$SESSION_NAME:0"
tmux attach-session -t "$SESSION_NAME"
