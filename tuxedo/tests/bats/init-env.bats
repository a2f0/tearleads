#!/usr/bin/env bats
# Tests for init-env-lib.sh functions

load 'helpers/common'

setup() {
    # Call common setup first
    ORIGINAL_PATH="$PATH"
    TEST_TMPDIR=$(mktemp -d)

    # Source the library
    source_init_env_lib
}

teardown() {
    export PATH="$ORIGINAL_PATH"
    if [ -d "$TEST_TMPDIR" ]; then
        rm -rf "$TEST_TMPDIR"
    fi
}

# path_prepend tests

@test "path_prepend adds directory to beginning of PATH" {
    local test_dir="$TEST_TMPDIR/testbin"
    mkdir -p "$test_dir"

    path_prepend "$test_dir"

    # Check that test_dir is at the beginning
    [[ "$PATH" == "$test_dir:"* ]]
}

@test "path_prepend does not duplicate existing path" {
    local test_dir="$TEST_TMPDIR/testbin"
    mkdir -p "$test_dir"

    # Add it twice
    path_prepend "$test_dir"
    local path_after_first="$PATH"
    path_prepend "$test_dir"

    # PATH should be unchanged after second call
    [ "$PATH" = "$path_after_first" ]
}

@test "path_prepend fails for non-existent directory" {
    local test_dir="$TEST_TMPDIR/nonexistent"

    run path_prepend "$test_dir"
    [ "$status" -eq 1 ]
}

# init_rbenv tests

@test "init_rbenv succeeds when rbenv is available via homebrew path" {
    skip_if_missing "rbenv"

    # Only run if rbenv is actually installed via Homebrew
    if [ ! -x /opt/homebrew/bin/rbenv ] && [ ! -x /usr/local/bin/rbenv ]; then
        skip "rbenv not installed via Homebrew"
    fi

    run init_rbenv
    [ "$status" -eq 0 ]
}

@test "init_rbenv adds shims to PATH" {
    skip_if_missing "rbenv"

    if [ ! -x /opt/homebrew/bin/rbenv ] && [ ! -x /usr/local/bin/rbenv ]; then
        skip "rbenv not installed via Homebrew"
    fi

    init_rbenv

    # After init, shims should be in PATH
    assert_in_path "$HOME/.rbenv/shims"
}

# init_pyenv tests

@test "init_pyenv succeeds when pyenv is available via homebrew path" {
    skip_if_missing "pyenv"

    if [ ! -x /opt/homebrew/bin/pyenv ] && [ ! -x /usr/local/bin/pyenv ]; then
        skip "pyenv not installed via Homebrew"
    fi

    run init_pyenv
    [ "$status" -eq 0 ]
}

@test "init_pyenv adds shims to PATH" {
    skip_if_missing "pyenv"

    if [ ! -x /opt/homebrew/bin/pyenv ] && [ ! -x /usr/local/bin/pyenv ]; then
        skip "pyenv not installed via Homebrew"
    fi

    init_pyenv

    # After init, shims should be in PATH
    assert_in_path "$HOME/.pyenv/shims"
}

# init_nvm tests

@test "init_nvm succeeds when nvm is available" {
    # Check if nvm is available in any location
    if [ ! -s /opt/homebrew/opt/nvm/nvm.sh ] && \
       [ ! -s /usr/local/opt/nvm/nvm.sh ] && \
       [ ! -s "$HOME/.nvm/nvm.sh" ]; then
        skip "nvm not installed"
    fi

    run init_nvm
    [ "$status" -eq 0 ]
}

# get_command_path tests

@test "get_command_path returns path for existing command" {
    run get_command_path "sh"
    [ "$status" -eq 0 ]
    [ -n "$output" ]
    [ -x "$output" ]
}

@test "get_command_path fails for non-existent command" {
    run get_command_path "nonexistent_command_12345"
    [ "$status" -ne 0 ]
}

# is_shim_command tests

@test "is_shim_command detects rbenv shim" {
    skip_if_missing "rbenv"

    # Initialize rbenv first
    if ! init_rbenv; then
        skip "rbenv init failed"
    fi

    # Check if ruby is available and is a shim
    if ! command -v ruby >/dev/null 2>&1; then
        skip "ruby not available"
    fi

    local ruby_path
    ruby_path=$(get_command_path "ruby")

    case "$ruby_path" in
        */.rbenv/shims/*)
            run is_shim_command "ruby"
            [ "$status" -eq 0 ]
            ;;
        *)
            skip "ruby is not from rbenv shims"
            ;;
    esac
}

@test "is_shim_command returns false for system command" {
    run is_shim_command "sh"
    [ "$status" -ne 0 ]
}
