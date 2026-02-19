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

assert_dashboard_respawn_call() {
    calls="$1"
    window_name="$2"
    script_name="$3"
    limit="${4:-20}"
    interval="${5:-30}"
    assert_contains "$calls" "respawn-pane -k -t tuxedo:${window_name}.0 sh -lc 'while true; do output="
    assert_contains "$calls" "\"/tmp/tux/scripts/${script_name}\" --limit ${limit} 2>&1 || true);"
    assert_contains "$calls" "printf \"%s"
    assert_contains "$calls" "\"\$output\"; sleep ${interval}; done'"
}

. "$TUXEDO_LIB"

TUXEDO_BASE_DIR="/tmp/base" TUXEDO_WORKSPACES=3 TUXEDO_EDITOR="vi" tuxedo_init "/tmp/tux"
assert_eq "/tmp/tux/config" "$CONFIG_DIR"
assert_eq "/tmp/tux/config/ghostty.conf" "$GHOSTTY_CONF"
assert_eq "/tmp/base" "$BASE_DIR"
assert_eq "3" "$NUM_WORKSPACES"
assert_eq "tuxedo" "$SESSION_NAME"
assert_eq "open-prs" "$OPEN_PRS_WINDOW_NAME"
assert_eq "closed-prs" "$CLOSED_PRS_WINDOW_NAME"
assert_eq "/tmp/base/tearleads-shared" "$SHARED_DIR"
assert_eq "/tmp/tux/config/tmux.conf" "$TMUX_CONF"
assert_eq "/tmp/tux/config/neovim.lua" "$NVIM_INIT"
assert_eq "vi" "$EDITOR"
assert_eq "/tmp/tux/config/tmux.conf" "$TUXEDO_TMUX_CONF"

unset TUXEDO_WORKSPACES
tuxedo_init "/tmp/tux"
assert_eq "10" "$NUM_WORKSPACES"

BASE_PATH="/base"
assert_eq "/tmp/ws/scripts:/tmp/ws/scripts/agents:/base" "$(workspace_path /tmp/ws)"
assert_eq "/base" "$(workspace_path "")"

assert_eq "short title" "$(tuxedo_truncate_title "short title" 25)"
assert_eq "a very long title th..." "$(tuxedo_truncate_title "a very long title that must be truncated" 23)"

USE_INNER_TMUX=true
CONFIG_DIR="/tmp/config"
cmd=$(inner_tmux_cmd tux-1)
assert_contains "$cmd" "tmux -L tuxedo-inner"
assert_contains "$cmd" "-f \"$CONFIG_DIR/tmux-inner.conf\""
assert_contains "$cmd" "new-session -A -s tux-1"

USE_INNER_TMUX=false
assert_eq "" "$(inner_tmux_cmd tux-1)"

TEMP_DIR=$(mktemp -d)
cleanup() {
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

PATH_BACKUP="$PATH"

test_inner_tmux_flag_defaults_to_true() {
    USE_INNER_TMUX=false
    unset TUXEDO_FORCE_NO_INNER_TMUX
    tuxedo_set_inner_tmux_flag
    assert_eq "true" "$USE_INNER_TMUX"
}

test_inner_tmux_flag_defaults_to_true

TUXEDO_FORCE_NO_INNER_TMUX=1 tuxedo_set_inner_tmux_flag
assert_eq "false" "$USE_INNER_TMUX"

# sync_all_titles sets @workspace options for automatic-rename-format
# Verify the function exists and handles missing tmux session gracefully
sync_all_titles

BASE_DIR="$TEMP_DIR"
WORKSPACE_PREFIX="tearleads"
WORKSPACE_START=2
SHARED_DIR="$BASE_DIR/${WORKSPACE_PREFIX}-shared"
MAIN_DIR="$BASE_DIR/${WORKSPACE_PREFIX}-main"
NUM_WORKSPACES=2
SESSION_NAME="tuxedo"
WORKSPACE_DIR="$BASE_DIR/tearleads2"
mkdir -p "$SHARED_DIR/.secrets" "$SHARED_DIR/.test_files" "$WORKSPACE_DIR" "$MAIN_DIR"
mkdir -p "$WORKSPACE_DIR/.secrets"

ensure_symlinks "$WORKSPACE_DIR"

[ -L "$WORKSPACE_DIR/.secrets" ] || fail "expected .secrets symlink"
[ -L "$WORKSPACE_DIR/.test_files" ] || fail "expected .test_files symlink"
assert_eq "../tearleads-shared/.secrets" "$(readlink "$WORKSPACE_DIR/.secrets")"
assert_eq "../tearleads-shared/.test_files" "$(readlink "$WORKSPACE_DIR/.test_files")"

tuxedo_prepare_shared_dirs
[ -L "$MAIN_DIR/.secrets" ] || fail "expected tearleads-main .secrets symlink"
[ -L "$BASE_DIR/tearleads2/.test_files" ] || fail "expected tearleads2 .test_files symlink"
[ -d "$SHARED_DIR/packages/api" ] || fail "expected shared packages/api directory"

# Test .env symlink for packages/api
# tuxedo_prepare_shared_dirs creates packages/api dir and touches .env, so just add content
echo "PORT=5001" > "$SHARED_DIR/packages/api/.env"
mkdir -p "$WORKSPACE_DIR/packages/api"

ensure_symlinks "$WORKSPACE_DIR"

[ -L "$WORKSPACE_DIR/packages/api/.env" ] || fail "expected packages/api/.env symlink"
assert_eq "../../../tearleads-shared/packages/api/.env" "$(readlink "$WORKSPACE_DIR/packages/api/.env")"

# sync_vscode_title sets @workspace option for a window (enables dynamic titles)
# Verify the function exists and handles missing tmux session gracefully
sync_vscode_title "$WORKSPACE_DIR" "tearleads2"

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
WORKSPACE_PREFIX="tearleads"
WORKSPACE_START=2
SHARED_DIR="$BASE_DIR/${WORKSPACE_PREFIX}-shared"
MAIN_DIR="$BASE_DIR/${WORKSPACE_PREFIX}-main"
DASHBOARD_DIR="$BASE_DIR/${WORKSPACE_PREFIX}"
NUM_WORKSPACES=2
SESSION_NAME="tuxedo"
TMUX_CONF="/tmp/tmux.conf"
EDITOR="true"
USE_SCREEN=false
sync_all_titles() {
    echo "sync-all" >> "$TMUX_CALLS"
}
tuxedo_attach_or_create
tmux_calls=$(cat "$TMUX_CALLS")
assert_contains "$tmux_calls" "new-session -d -s tuxedo -c $DASHBOARD_DIR -n open-prs -e PATH="
assert_contains "$tmux_calls" "new-window -t tuxedo: -c $DASHBOARD_DIR -n closed-prs -e PATH="
assert_contains "$tmux_calls" "new-window -t tuxedo: -c $SHARED_DIR -n tearleads-shared -e PATH="
assert_contains "$tmux_calls" "new-window -t tuxedo: -c $MAIN_DIR -n tearleads-main -e PATH="
assert_dashboard_respawn_call "$tmux_calls" "open-prs" "listOpenPrs.sh"
assert_dashboard_respawn_call "$tmux_calls" "closed-prs" "listRecentClosedPrs.sh"
assert_contains "$tmux_calls" "attach-session -t tuxedo"

TMUX_DASHBOARD_CALLS="$TEMP_DIR/tmux.dashboard.calls"
export TMUX_DASHBOARD_CALLS
cat <<'EOF' > "$TEMP_DIR/bin/tmux"
#!/bin/sh
echo "$@" >> "$TMUX_DASHBOARD_CALLS"
exit 0
EOF
chmod +x "$TEMP_DIR/bin/tmux"

PATH="$TEMP_DIR/bin:$PATH_BACKUP"
SESSION_NAME="tuxedo"
TUXEDO_PR_REFRESH_SECONDS='30; rm -rf ~'
TUXEDO_PR_LIST_LIMIT='20 && whoami'
tuxedo_start_pr_dashboards
tmux_dashboard_calls=$(cat "$TMUX_DASHBOARD_CALLS")
assert_dashboard_respawn_call "$tmux_dashboard_calls" "open-prs" "listOpenPrs.sh"
assert_dashboard_respawn_call "$tmux_dashboard_calls" "closed-prs" "listRecentClosedPrs.sh"
unset TUXEDO_PR_REFRESH_SECONDS
unset TUXEDO_PR_LIST_LIMIT

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
    tmux_attach_calls=$(cat "$TMUX_ATTACH_CALLS")
    assert_contains "$tmux_attach_calls" "has-session -t tuxedo"
    assert_dashboard_respawn_call "$tmux_attach_calls" "open-prs" "listOpenPrs.sh"
    assert_dashboard_respawn_call "$tmux_attach_calls" "closed-prs" "listRecentClosedPrs.sh"
    assert_contains "$tmux_attach_calls" "sync-all"
    assert_contains "$tmux_attach_calls" "attach-session -t tuxedo"
    assert_not_contains "$tmux_attach_calls" "new-session -d -s tuxedo"

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
    cat <<'EOF' > "$TEMP_DIR/bin/tmux"
#!/bin/sh
if [ "$1" = "has-session" ]; then
    exit 0
fi
if [ "$1" = "-L" ] && [ "$2" = "tuxedo-inner" ]; then
    if [ "$3" = "list-sessions" ]; then
        echo "tux-main: 1 windows"
        exit 0
    fi
    exit 0
fi
exit 0
EOF
    chmod +x "$TEMP_DIR/bin/pgrep" "$TEMP_DIR/bin/pkill" "$TEMP_DIR/bin/tmux"

    PATH="$TEMP_DIR/bin:$PATH_BACKUP"
    "$REPO_ROOT/tuxedo/tuxedoKill.sh" > "$KILL_OUT"
    assert_contains "$(cat "$KILL_OUT")" "Killed 1 neovim session(s)"
    assert_contains "$(cat "$KILL_OUT")" "Killed tmux session: tuxedo"

    PATH="$PATH_BACKUP"
}

test_tuxedo_kill_no_sessions() {
    KILL_OUT="$TEMP_DIR/kill.out"
    cat <<'EOF' > "$TEMP_DIR/bin/tmux"
#!/bin/sh
if [ "$1" = "has-session" ]; then
    exit 1
fi
if [ "$1" = "-L" ] && [ "$2" = "tuxedo-inner" ]; then
    if [ "$3" = "list-sessions" ]; then
        exit 1
    fi
    exit 1
fi
exit 0
EOF
    chmod +x "$TEMP_DIR/bin/tmux"

    PATH="$TEMP_DIR/bin:$PATH_BACKUP"
    "$REPO_ROOT/tuxedo/tuxedoKill.sh" > "$KILL_OUT"
    assert_contains "$(cat "$KILL_OUT")" "No tmux session 'tuxedo' found"

    PATH="$PATH_BACKUP"
}

test_tmux_attach_existing_session
test_tuxedo_kill_success
test_tuxedo_kill_no_sessions

test_tmux_conf_syntax() {
    TMUX_CONF_REAL="$REPO_ROOT/tuxedo/config/tmux.conf"
    [ -f "$TMUX_CONF_REAL" ] || fail "tmux.conf not found at $TMUX_CONF_REAL"
    TEST_SOCKET="tuxedo-test-$$"
    tmux -f "$TMUX_CONF_REAL" -L "$TEST_SOCKET" start-server 2>"$TEMP_DIR/tmux-syntax.err" || {
        fail "tmux.conf has syntax errors: $(cat "$TEMP_DIR/tmux-syntax.err")"
    }
    tmux -L "$TEST_SOCKET" kill-server 2>/dev/null || true
}

test_tmux_conf_syntax

test_inner_tmux_setup_editor_skips_when_disabled() {
    PATH="$TEMP_DIR/bin:$PATH_BACKUP"
    USE_INNER_TMUX=false
    # inner_tmux_setup_editor should return early when USE_INNER_TMUX=false
    inner_tmux_setup_editor "test-session" "nvim"
    # Function returns immediately, no tmux calls

    PATH="$PATH_BACKUP"
}

test_inner_tmux_cmd_returns_command_when_enabled() {
    USE_INNER_TMUX=true
    CONFIG_DIR="/tmp/config"
    cmd=$(inner_tmux_cmd "tux-test")
    assert_contains "$cmd" "tmux -L tuxedo-inner"
    assert_contains "$cmd" "-f \"/tmp/config/tmux-inner.conf\""
    assert_contains "$cmd" "new-session -A -s tux-test"
}

test_inner_tmux_cmd_returns_empty_when_disabled() {
    USE_INNER_TMUX=false
    cmd=$(inner_tmux_cmd "tux-test")
    assert_eq "" "$cmd"
}

test_inner_tmux_setup_editor_skips_when_disabled
test_inner_tmux_cmd_returns_command_when_enabled
test_inner_tmux_cmd_returns_empty_when_disabled

echo "OK"
