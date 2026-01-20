#!/bin/sh
set -eu

TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(cd -- "$TEST_DIR/../.." && pwd -P)
TUXEDO_SCRIPT="$REPO_ROOT/tuxedo/tuxedo.sh"

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

TUXEDO_SCRIPT_PATH="$TUXEDO_SCRIPT" TUXEDO_SKIP_MAIN=1 . "$TUXEDO_SCRIPT"

BASE_PATH="/base"
assert_eq "/tmp/ws/scripts:/tmp/ws/scripts/agents:/base" "$(workspace_path /tmp/ws)"
assert_eq "/base" "$(workspace_path "")"

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

BASE_DIR="$TEMP_DIR"
SHARED_DIR="$BASE_DIR/rapid-shared"
WORKSPACE_DIR="$BASE_DIR/rapid2"
mkdir -p "$SHARED_DIR/.secrets" "$SHARED_DIR/.test_files" "$WORKSPACE_DIR"
mkdir -p "$WORKSPACE_DIR/.secrets"

ensure_symlinks "$WORKSPACE_DIR"

[ -L "$WORKSPACE_DIR/.secrets" ] || fail "expected .secrets symlink"
[ -L "$WORKSPACE_DIR/.test_files" ] || fail "expected .test_files symlink"
assert_eq "../rapid-shared/.secrets" "$(readlink "$WORKSPACE_DIR/.secrets")"
assert_eq "../rapid-shared/.test_files" "$(readlink "$WORKSPACE_DIR/.test_files")"

update_from_main "$BASE_DIR/not-a-repo"

echo "OK"
