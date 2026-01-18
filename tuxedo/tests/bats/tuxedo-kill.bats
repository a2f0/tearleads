#!/usr/bin/env bats
# Tests for tuxedo-kill-lib.sh functions

load 'helpers/common'

setup() {
    ORIGINAL_PATH="$PATH"
    TEST_TMPDIR=$(mktemp -d)

    # Source the library
    source_tuxedo_kill_lib
}

teardown() {
    export PATH="$ORIGINAL_PATH"
    if [ -d "$TEST_TMPDIR" ]; then
        rm -rf "$TEST_TMPDIR"
    fi
}

# count_screen_sessions tests

@test "count_screen_sessions returns 0 when no tux-* sessions" {
    skip_if_missing "pgrep"

    run count_screen_sessions
    [ "$status" -eq 0 ]
    # Output should be a number (may be 0 or more depending on environment)
    [[ "$output" =~ ^[0-9]+$ ]]
}

# count_screen_sockets tests

@test "count_screen_sockets returns 0 when no sockets exist" {
    # Use a temp HOME to ensure no sockets
    local old_home="$HOME"
    export HOME="$TEST_TMPDIR"

    run count_screen_sockets
    [ "$status" -eq 0 ]
    [ "$output" = "0" ]

    export HOME="$old_home"
}

@test "count_screen_sockets counts tux-* sockets" {
    local old_home="$HOME"
    export HOME="$TEST_TMPDIR"

    # Create mock socket files
    mkdir -p "$TEST_TMPDIR/.screen"
    touch "$TEST_TMPDIR/.screen/12345.tux-main"
    touch "$TEST_TMPDIR/.screen/12346.tux-2"
    touch "$TEST_TMPDIR/.screen/12347.other-session"

    run count_screen_sockets
    [ "$status" -eq 0 ]
    [ "$output" = "2" ]

    export HOME="$old_home"
}

# cleanup_screen_sockets tests

@test "cleanup_screen_sockets removes tux-* sockets" {
    local old_home="$HOME"
    export HOME="$TEST_TMPDIR"

    # Create mock socket files
    mkdir -p "$TEST_TMPDIR/.screen"
    touch "$TEST_TMPDIR/.screen/12345.tux-main"
    touch "$TEST_TMPDIR/.screen/12346.tux-2"
    touch "$TEST_TMPDIR/.screen/12347.other-session"

    run cleanup_screen_sockets
    [ "$status" -eq 0 ]

    # tux-* sockets should be gone
    [ ! -e "$TEST_TMPDIR/.screen/12345.tux-main" ]
    [ ! -e "$TEST_TMPDIR/.screen/12346.tux-2" ]

    # other-session should still exist
    [ -e "$TEST_TMPDIR/.screen/12347.other-session" ]

    export HOME="$old_home"
}

@test "cleanup_screen_sockets returns failure when no sockets to clean" {
    local old_home="$HOME"
    export HOME="$TEST_TMPDIR"

    # Create directory but no tux-* sockets
    mkdir -p "$TEST_TMPDIR/.screen"
    touch "$TEST_TMPDIR/.screen/12347.other-session"

    run cleanup_screen_sockets
    [ "$status" -ne 0 ]

    export HOME="$old_home"
}

# tmux_session_exists tests

@test "tmux_session_exists returns false for non-existent session" {
    skip_if_missing "tmux"

    run tmux_session_exists "nonexistent_test_session_12345"
    [ "$status" -ne 0 ]
}

# count_nvim_sessions tests

@test "count_nvim_sessions returns 0 when no matching nvim processes" {
    skip_if_missing "pgrep"

    run count_nvim_sessions "/nonexistent/path/scripts"
    [ "$status" -eq 0 ]
    [ "$output" = "0" ]
}

# kill_screen_sessions tests

@test "kill_screen_sessions returns failure when no sessions to kill" {
    skip_if_missing "pgrep"
    skip_if_missing "pkill"

    # Ensure no tux-* sessions are running (for this test)
    local count
    count=$(count_screen_sessions)

    if [ "$count" -gt 0 ]; then
        skip "tux-* screen sessions are running; cannot test negative case"
    fi

    run kill_screen_sessions
    [ "$status" -ne 0 ]
}

# kill_nvim_sessions tests

@test "kill_nvim_sessions returns failure when no sessions to kill" {
    skip_if_missing "pgrep"
    skip_if_missing "pkill"

    run kill_nvim_sessions "/nonexistent/path/scripts"
    [ "$status" -ne 0 ]
}

# kill_tmux_session tests

@test "kill_tmux_session returns failure for non-existent session" {
    skip_if_missing "tmux"

    run kill_tmux_session "nonexistent_test_session_12345"
    [ "$status" -ne 0 ]
}
