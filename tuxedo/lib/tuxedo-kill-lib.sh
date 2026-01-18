#!/bin/sh
# Testable library functions for tuxedo session cleanup
# Sourced by tuxedoKill.sh and used in tests

# Count tux-* screen sessions by finding matching processes
# Returns the count via stdout
count_screen_sessions() {
    if ! command -v pgrep >/dev/null 2>&1; then
        echo "0"
        return 1
    fi

    screen_pids=$(pgrep -f 'screen.*tux-' 2>/dev/null || true)
    if [ -n "$screen_pids" ]; then
        echo "$screen_pids" | wc -l | tr -d ' '
    else
        echo "0"
    fi
}

# Kill all tux-* screen sessions
# Returns 0 if any were killed, 1 if none found
kill_screen_sessions() {
    if ! command -v pgrep >/dev/null 2>&1 || ! command -v pkill >/dev/null 2>&1; then
        return 1
    fi

    screen_pids=$(pgrep -f 'screen.*tux-' 2>/dev/null || true)
    if [ -n "$screen_pids" ]; then
        pkill -9 -f 'screen.*tux-' 2>/dev/null || true
        return 0
    fi
    return 1
}

# Count tux-* screen sockets in ~/.screen
# Returns the count via stdout
count_screen_sockets() {
    count=0
    if [ -d "$HOME/.screen" ]; then
        for socket in "$HOME/.screen/"*tux-*; do
            [ -e "$socket" ] || continue
            count=$((count + 1))
        done
    fi
    echo "$count"
}

# Clean up screen socket files in ~/.screen for tux-* sessions
# Returns 0 if any were cleaned, 1 if none found
cleanup_screen_sockets() {
    cleaned=0

    # Clean ~/.screen (Homebrew's screen)
    if [ -d "$HOME/.screen" ]; then
        for socket in "$HOME/.screen/"*tux-*; do
            [ -e "$socket" ] || continue
            rm -f "$socket" && cleaned=$((cleaned + 1))
        done
    fi

    # Also run screen -wipe to clean system temp location
    screen -wipe >/dev/null 2>&1 || true

    [ "$cleaned" -gt 0 ]
}

# Check if a tmux session exists
# Usage: tmux_session_exists "session_name"
tmux_session_exists() {
    session_name="$1"
    tmux has-session -t "$session_name" 2>/dev/null
}

# Kill a tmux session
# Usage: kill_tmux_session "session_name"
# Returns 0 if killed, 1 if not found
kill_tmux_session() {
    session_name="$1"
    if tmux_session_exists "$session_name"; then
        tmux kill-session -t "$session_name"
        return 0
    fi
    return 1
}

# Count tuxedo neovim sessions (identified by config path)
# Usage: count_nvim_sessions "/path/to/scripts"
# Returns the count via stdout
count_nvim_sessions() {
    script_dir="$1"
    if ! command -v pgrep >/dev/null 2>&1; then
        echo "0"
        return 1
    fi

    nvim_pattern="nvim.*$script_dir/config/neovim.lua"
    nvim_pids=$(pgrep -f "$nvim_pattern" 2>/dev/null || true)
    if [ -n "$nvim_pids" ]; then
        echo "$nvim_pids" | wc -l | tr -d ' '
    else
        echo "0"
    fi
}

# Kill tuxedo neovim sessions (identified by config path)
# Usage: kill_nvim_sessions "/path/to/scripts"
# Returns 0 if any were killed, 1 if none found
kill_nvim_sessions() {
    script_dir="$1"
    if ! command -v pgrep >/dev/null 2>&1 || ! command -v pkill >/dev/null 2>&1; then
        return 1
    fi

    nvim_pattern="nvim.*$script_dir/config/neovim.lua"
    nvim_pids=$(pgrep -f "$nvim_pattern" 2>/dev/null || true)
    if [ -n "$nvim_pids" ]; then
        pkill -9 -f "$nvim_pattern" 2>/dev/null || true
        return 0
    fi
    return 1
}
