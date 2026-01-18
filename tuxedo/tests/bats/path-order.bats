#!/usr/bin/env bats
# Tests for PATH order verification - ensures shims come before /usr/bin

load 'helpers/common'

setup() {
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

# verify_path_order tests

@test "verify_path_order fails when shims not in PATH" {
    # Set a PATH without any shims
    export PATH="/usr/bin:/bin:/usr/sbin:/sbin"

    run verify_path_order "rbenv"
    [ "$status" -ne 0 ]
}

@test "verify_path_order succeeds when shims before /usr/bin" {
    # Set PATH with rbenv shims first
    export PATH="$HOME/.rbenv/shims:/usr/bin:/bin"

    # Create the shims directory for the test
    mkdir -p "$HOME/.rbenv/shims" 2>/dev/null || true

    if [ -d "$HOME/.rbenv/shims" ]; then
        run verify_path_order "rbenv"
        [ "$status" -eq 0 ]
    else
        skip "Cannot create ~/.rbenv/shims for test"
    fi
}

@test "verify_path_order fails when shims after /usr/bin" {
    # Set PATH with /usr/bin before shims
    export PATH="/usr/bin:$HOME/.rbenv/shims:/bin"

    run verify_path_order "rbenv"
    [ "$status" -ne 0 ]
}

@test "verify_path_order succeeds when /usr/bin not in PATH" {
    # Set PATH without /usr/bin
    export PATH="$HOME/.rbenv/shims:/opt/homebrew/bin:/bin"

    # Create the shims directory if needed
    mkdir -p "$HOME/.rbenv/shims" 2>/dev/null || true

    if [ -d "$HOME/.rbenv/shims" ]; then
        run verify_path_order "rbenv"
        [ "$status" -eq 0 ]
    else
        skip "Cannot create ~/.rbenv/shims for test"
    fi
}

@test "verify_path_order works for pyenv" {
    # Set PATH with pyenv shims first
    export PYENV_ROOT="$HOME/.pyenv"
    export PATH="$PYENV_ROOT/shims:/usr/bin:/bin"

    # Create the shims directory if needed
    mkdir -p "$PYENV_ROOT/shims" 2>/dev/null || true

    if [ -d "$PYENV_ROOT/shims" ]; then
        run verify_path_order "pyenv"
        [ "$status" -eq 0 ]
    else
        skip "Cannot create ~/.pyenv/shims for test"
    fi
}

@test "verify_path_order fails for unknown manager" {
    run verify_path_order "unknown_manager"
    [ "$status" -ne 0 ]
}

# Integration tests - verify actual PATH after init

@test "rbenv shims come before /usr/bin after init_rbenv" {
    skip_if_missing "rbenv"

    if [ ! -x /opt/homebrew/bin/rbenv ] && [ ! -x /usr/local/bin/rbenv ]; then
        skip "rbenv not installed via Homebrew"
    fi

    # Reset PATH to simulate a fresh shell with /usr/bin early
    export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

    # Initialize Homebrew first (required for rbenv on macOS)
    init_homebrew || true

    # Initialize rbenv
    init_rbenv

    # Verify PATH order
    run verify_path_order "rbenv"
    [ "$status" -eq 0 ]
}

@test "pyenv shims come before /usr/bin after init_pyenv" {
    skip_if_missing "pyenv"

    if [ ! -x /opt/homebrew/bin/pyenv ] && [ ! -x /usr/local/bin/pyenv ]; then
        skip "pyenv not installed via Homebrew"
    fi

    # Reset PATH to simulate a fresh shell with /usr/bin early
    export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

    # Initialize Homebrew first (required for pyenv on macOS)
    init_homebrew || true

    # Initialize pyenv
    init_pyenv

    # Verify PATH order
    run verify_path_order "pyenv"
    [ "$status" -eq 0 ]
}

@test "which ruby returns rbenv shim after init" {
    skip_if_missing "rbenv"

    if [ ! -x /opt/homebrew/bin/rbenv ] && [ ! -x /usr/local/bin/rbenv ]; then
        skip "rbenv not installed via Homebrew"
    fi

    # Reset PATH
    export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

    # Initialize
    init_homebrew || true
    init_rbenv

    # Check which ruby
    local ruby_path
    ruby_path=$(command -v ruby 2>/dev/null || true)

    if [ -z "$ruby_path" ]; then
        skip "ruby not available"
    fi

    # Should be from rbenv shims
    [[ "$ruby_path" == *"/.rbenv/shims/ruby" ]]
}

@test "which python returns pyenv shim after init" {
    skip_if_missing "pyenv"

    if [ ! -x /opt/homebrew/bin/pyenv ] && [ ! -x /usr/local/bin/pyenv ]; then
        skip "pyenv not installed via Homebrew"
    fi

    # Reset PATH
    export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

    # Initialize
    init_homebrew || true
    init_pyenv

    # Check which python
    local python_path
    python_path=$(command -v python 2>/dev/null || true)

    if [ -z "$python_path" ]; then
        # Try python3
        python_path=$(command -v python3 2>/dev/null || true)
    fi

    if [ -z "$python_path" ]; then
        skip "python not available"
    fi

    # Should be from pyenv shims
    [[ "$python_path" == *"/.pyenv/shims/"* ]]
}
