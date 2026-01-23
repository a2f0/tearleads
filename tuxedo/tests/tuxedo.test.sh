#!/bin/sh
set -eu

TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(cd -- "$TEST_DIR/../.." && pwd -P)
TUXEDO_LIB="$REPO_ROOT/tuxedo/lib/tuxedo-lib.sh"

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

assert_eq() {
    expected="$1"
    actual="$2"
    if [ "$expected" != "$actual" ]; then
        fail "expected '$expected' got '$actual'"
    fi
}

assert_contains() {
    haystack="$1"
    needle="$2"
    case "$haystack" in
        *"$needle"*) return 0 ;;
        *) fail "expected '$haystack' to contain '$needle'" ;;
    esac
}

assert_not_contains() {
    haystack="$1"
    needle="$2"
    case "$haystack" in
        *"$needle"*) fail "did not expect '$haystack' to contain '$needle'" ;;
        *) return 0 ;;
    esac
}

. "$TUXEDO_LIB"

TUXEDO_BASE_DIR="/tmp/base" TUXEDO_WORKSPACES=3 TUXEDO_EDITOR="vi" tuxedo_init "/tmp/tux"
assert_eq "/tmp/tux/config" "$CONFIG_DIR"
assert_eq "/tmp/tux/config/ghostty.conf" "$GHOSTTY_CONF"
assert_eq "/tmp/base" "$BASE_DIR"
assert_eq "3" "$NUM_WORKSPACES"
assert_eq "tuxedo" "$SESSION_NAME"
assert_eq "/tmp/base/rapid-shared" "$SHARED_DIR"
assert_eq "/tmp/tux/config/tmux.conf" "$TMUX_CONF"
assert_eq "/tmp/tux/config/neovim.lua" "$NVIM_INIT"
assert_eq "vi" "$EDITOR"
assert_eq "/tmp/tux/config/tmux.conf" "$TUXEDO_TMUX_CONF"

BASE_PATH="/base"
assert_eq "/tmp/ws/scripts:/tmp/ws/scripts/agents:/base" "$(workspace_path /tmp/ws)"
assert_eq "/base" "$(workspace_path "")"

assert_eq "short title" "$(tuxedo_truncate_title "short title" 25)"
assert_eq "a very long title th..." "$(tuxedo_truncate_title "a very long title that must be truncated" 23)"

USE_SCREEN=true
CONFIG_DIR="/tmp/config"
cmd=$(screen_cmd tux-1)
assert_contains "$cmd" "screen -T tmux-256color"
assert_contains "$cmd" "-c \"$CONFIG_DIR/screenrc\""

USE_SCREEN=false
assert_eq "" "$(screen_cmd tux-1)"

TEMP_DIR=$(mktemp -d)
cleanup() {
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

PATH_BACKUP="$PATH"

test_screen_flag_detects_screen() {
    mkdir -p "$TEMP_DIR/bin"
    cat <<'EOF' > "$TEMP_DIR/bin/screen"
#!/bin/sh
exit 0
EOF
    chmod +x "$TEMP_DIR/bin/screen"
    PATH="$TEMP_DIR/bin:$PATH_BACKUP"
    USE_SCREEN=false
    unset TUXEDO_FORCE_SCREEN
    unset TUXEDO_FORCE_NO_SCREEN
    tuxedo_set_screen_flag
    assert_eq "true" "$USE_SCREEN"
    PATH="$PATH_BACKUP"
}

test_screen_flag_detects_screen

TUXEDO_FORCE_NO_SCREEN=1 tuxedo_set_screen_flag
assert_eq "false" "$USE_SCREEN"
TUXEDO_FORCE_SCREEN=1 tuxedo_set_screen_flag
assert_eq "true" "$USE_SCREEN"

UPDATE_LOG="$TEMP_DIR/update.log"
(
    update_from_main() {
        echo "$1" >> "$UPDATE_LOG"
    }
    BASE_DIR="$TEMP_DIR/base"
    NUM_WORKSPACES=3
    update_all_workspaces
)
assert_contains "$(cat "$UPDATE_LOG")" "$TEMP_DIR/base/rapid-main"
assert_contains "$(cat "$UPDATE_LOG")" "$TEMP_DIR/base/rapid2"
assert_contains "$(cat "$UPDATE_LOG")" "$TEMP_DIR/base/rapid3"

TITLE_LOG="$TEMP_DIR/title.log"
(
    sync_vscode_title() {
        echo "$1:$2" >> "$TITLE_LOG"
    }
    BASE_DIR="$TEMP_DIR/base"
    NUM_WORKSPACES=3
    sync_all_titles
)
assert_contains "$(cat "$TITLE_LOG")" "$TEMP_DIR/base/rapid-main:rapid-main"
assert_contains "$(cat "$TITLE_LOG")" "$TEMP_DIR/base/rapid2:rapid2"
assert_contains "$(cat "$TITLE_LOG")" "$TEMP_DIR/base/rapid3:rapid3"

BASE_DIR="$TEMP_DIR"
SHARED_DIR="$BASE_DIR/rapid-shared"
NUM_WORKSPACES=2
SESSION_NAME="tuxedo"
WORKSPACE_DIR="$BASE_DIR/rapid2"
mkdir -p "$SHARED_DIR/.secrets" "$SHARED_DIR/.test_files" "$WORKSPACE_DIR" "$BASE_DIR/rapid-main"
mkdir -p "$WORKSPACE_DIR/.secrets"

ensure_symlinks "$WORKSPACE_DIR"

[ -L "$WORKSPACE_DIR/.secrets" ] || fail "expected .secrets symlink"
[ -L "$WORKSPACE_DIR/.test_files" ] || fail "expected .test_files symlink"
assert_eq "../rapid-shared/.secrets" "$(readlink "$WORKSPACE_DIR/.secrets")"
assert_eq "../rapid-shared/.test_files" "$(readlink "$WORKSPACE_DIR/.test_files")"

tuxedo_prepare_shared_dirs
[ -L "$BASE_DIR/rapid-main/.secrets" ] || fail "expected rapid-main .secrets symlink"
[ -L "$BASE_DIR/rapid2/.test_files" ] || fail "expected rapid2 .test_files symlink"
[ -d "$SHARED_DIR/packages/api" ] || fail "expected shared packages/api directory"

# Test .env symlink for packages/api
# tuxedo_prepare_shared_dirs creates packages/api dir and touches .env, so just add content
echo "PORT=5001" > "$SHARED_DIR/packages/api/.env"
mkdir -p "$WORKSPACE_DIR/packages/api"

ensure_symlinks "$WORKSPACE_DIR"

[ -L "$WORKSPACE_DIR/packages/api/.env" ] || fail "expected packages/api/.env symlink"
assert_eq "../../../rapid-shared/packages/api/.env" "$(readlink "$WORKSPACE_DIR/packages/api/.env")"

update_from_main "$BASE_DIR/not-a-repo"

if command -v jq >/dev/null 2>&1; then
    TMUX_LOG="$TEMP_DIR/tmux.log"
    export TMUX_LOG
    mkdir -p "$TEMP_DIR/bin"
    cat <<'EOF' > "$TEMP_DIR/bin/tmux"
#!/bin/sh
echo "$@" >> "$TMUX_LOG"
EOF
    chmod +x "$TEMP_DIR/bin/tmux"
    PATH="$TEMP_DIR/bin:$PATH_BACKUP"

    mkdir -p "$WORKSPACE_DIR/.vscode"
    cat <<'EOF' > "$WORKSPACE_DIR/.vscode/settings.json"
{
  "window.title": "tuxedo test window title that is pretty long"
}
EOF

    sync_vscode_title "$WORKSPACE_DIR" "rapid2"
    expected_title=$(tuxedo_truncate_title "tuxedo test window title that is pretty long" 25)
    assert_contains "$(cat "$TMUX_LOG")" "rename-window -t tuxedo:rapid2 $expected_title"
fi

GHOSTTY_LOG="$TEMP_DIR/ghostty.log"
export GHOSTTY_LOG
mkdir -p "$TEMP_DIR/bin"
cat <<'EOF' > "$TEMP_DIR/bin/ghostty"
#!/bin/sh
echo "$@" > "$GHOSTTY_LOG"
EOF
chmod +x "$TEMP_DIR/bin/ghostty"

GHOSTTY_CONF="/tmp/ghostty.conf"
(
    PATH="$TEMP_DIR/bin:$PATH_BACKUP"
    exec 1>"$TEMP_DIR/no-tty.out"
    tuxedo_maybe_launch_ghostty "/tmp/tuxedo.sh" "arg1" "arg2"
    echo "after" > "$TEMP_DIR/ghostty-after"
)
assert_contains "$(cat "$GHOSTTY_LOG")" "--config-file=$GHOSTTY_CONF -e /tmp/tuxedo.sh arg1 arg2"

(
    PATH=""
    exec 1>"$TEMP_DIR/no-tty-no-ghostty.out"
    tuxedo_maybe_launch_ghostty "/tmp/tuxedo.sh" "arg3"
    echo "after" > "$TEMP_DIR/no-ghostty-after"
)
assert_eq "after" "$(cat "$TEMP_DIR/no-ghostty-after")"

TMUX_CALLS="$TEMP_DIR/tmux.calls"
export TMUX_CALLS
cat <<'EOF' > "$TEMP_DIR/bin/tmux"
#!/bin/sh
if [ "$1" = "has-session" ]; then
    exit 1
fi
echo "$@" >> "$TMUX_CALLS"
exit 0
EOF
chmod +x "$TEMP_DIR/bin/tmux"

PATH="$TEMP_DIR/bin:$PATH_BACKUP"
BASE_DIR="$TEMP_DIR/tmux-base"
SHARED_DIR="$BASE_DIR/rapid-shared"
NUM_WORKSPACES=2
SESSION_NAME="tuxedo"
TMUX_CONF="/tmp/tmux.conf"
EDITOR="true"
USE_SCREEN=false
sync_all_titles() {
    echo "sync-all" >> "$TMUX_CALLS"
}
tuxedo_attach_or_create
assert_contains "$(cat "$TMUX_CALLS")" "new-session -d -s tuxedo -c $SHARED_DIR -n rapid-shared -e PATH="
assert_contains "$(cat "$TMUX_CALLS")" "new-window -t tuxedo -c $BASE_DIR/rapid-main -n rapid-main -e PATH="
assert_contains "$(cat "$TMUX_CALLS")" "attach-session -t tuxedo"

test_tmux_attach_existing_session() {
    TMUX_ATTACH_CALLS="$TEMP_DIR/tmux.attach.calls"
    export TMUX_ATTACH_CALLS
    cat <<'EOF' > "$TEMP_DIR/bin/tmux"
#!/bin/sh
if [ "$1" = "has-session" ]; then
    echo "$@" >> "$TMUX_ATTACH_CALLS"
    exit 0
fi
echo "$@" >> "$TMUX_ATTACH_CALLS"
exit 0
EOF
    chmod +x "$TEMP_DIR/bin/tmux"

    PATH="$TEMP_DIR/bin:$PATH_BACKUP"
    SESSION_NAME="tuxedo"
    sync_all_titles() {
        echo "sync-all" >> "$TMUX_ATTACH_CALLS"
    }
    tuxedo_attach_or_create
    assert_contains "$(cat "$TMUX_ATTACH_CALLS")" "has-session -t tuxedo"
    assert_contains "$(cat "$TMUX_ATTACH_CALLS")" "sync-all"
    assert_contains "$(cat "$TMUX_ATTACH_CALLS")" "attach-session -t tuxedo"
    assert_not_contains "$(cat "$TMUX_ATTACH_CALLS")" "new-session -d -s tuxedo"

    PATH="$PATH_BACKUP"
}

test_tuxedo_kill_success() {
    KILL_OUT="$TEMP_DIR/kill.out"
    cat <<'EOF' > "$TEMP_DIR/bin/pgrep"
#!/bin/sh
echo "1234"
EOF
    cat <<'EOF' > "$TEMP_DIR/bin/pkill"
#!/bin/sh
exit 0
EOF
    cat <<'EOF' > "$TEMP_DIR/bin/screen"
#!/bin/sh
case "$1" in
    -wipe) exit 0 ;;
    -ls) echo "1234.tux-1 (Detached)"; exit 0 ;;
    -X) exit 0 ;;
    *) exit 0 ;;
esac
EOF
    cat <<'EOF' > "$TEMP_DIR/bin/tmux"
#!/bin/sh
if [ "$1" = "has-session" ]; then
    exit 0
fi
exit 0
EOF
    chmod +x "$TEMP_DIR/bin/pgrep" "$TEMP_DIR/bin/pkill" "$TEMP_DIR/bin/screen" "$TEMP_DIR/bin/tmux"

    PATH="$TEMP_DIR/bin:$PATH_BACKUP"
    "$REPO_ROOT/tuxedo/tuxedoKill.sh" > "$KILL_OUT"
    assert_contains "$(cat "$KILL_OUT")" "Killed 1 neovim session(s)"
    assert_contains "$(cat "$KILL_OUT")" "Killed 1 screen session(s)"
    assert_contains "$(cat "$KILL_OUT")" "Killed tmux session: tuxedo"

    PATH="$PATH_BACKUP"
}

test_tuxedo_kill_no_sessions() {
    KILL_OUT="$TEMP_DIR/kill.out"
    cat <<'EOF' > "$TEMP_DIR/bin/screen"
#!/bin/sh
case "$1" in
    -wipe) exit 0 ;;
    -ls) exit 0 ;;
    -X) exit 1 ;;
    *) exit 0 ;;
esac
EOF
    cat <<'EOF' > "$TEMP_DIR/bin/tmux"
#!/bin/sh
if [ "$1" = "has-session" ]; then
    exit 1
fi
exit 0
EOF
    chmod +x "$TEMP_DIR/bin/screen" "$TEMP_DIR/bin/tmux"

    PATH="$TEMP_DIR/bin:$PATH_BACKUP"
    "$REPO_ROOT/tuxedo/tuxedoKill.sh" > "$KILL_OUT"
    assert_contains "$(cat "$KILL_OUT")" "No tux-* screen sessions found"
    assert_contains "$(cat "$KILL_OUT")" "No tmux session 'tuxedo' found"

    PATH="$PATH_BACKUP"
}

test_tmux_attach_existing_session
test_tuxedo_kill_success
test_tuxedo_kill_no_sessions

echo "OK"
