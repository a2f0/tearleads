#!/usr/bin/env bats
# Tests for screen shell PATH behavior
# These tests verify that version manager shims survive shell rc file processing

load 'helpers/common'

setup() {
    ORIGINAL_PATH="$PATH"
    TEST_TMPDIR=$(mktemp -d)
    source_init_env_lib
}

teardown() {
    export PATH="$ORIGINAL_PATH"
    if [ -d "$TEST_TMPDIR" ]; then
        rm -rf "$TEST_TMPDIR"
    fi
}

# This test demonstrates the problem that tuxedo-shell.sh solves:
# When shell rc files prepend to PATH, shims get pushed behind /usr/bin.
# The fix is to source init-env.sh AFTER rc files, which tuxedo-shell.sh does.
@test "PATH broken when shell rc prepends - init_rbenv fixes it" {
    skip_if_missing "rbenv"

    if [ ! -x /opt/homebrew/bin/rbenv ] && [ ! -x /usr/local/bin/rbenv ]; then
        skip "rbenv not installed via Homebrew"
    fi

    # Start with a PATH that simulates what shell rc files might create
    # (this is the "broken" state after rc files have run)
    export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

    # Verify PATH is "broken" (no shims)
    run verify_path_order "rbenv"
    [ "$status" -ne 0 ]

    # Now run init_rbenv to fix it (this is what tuxedo's .zshrc does)
    init_homebrew || true
    init_rbenv

    # After init_rbenv, shims should be first
    run verify_path_order "rbenv"
    [ "$status" -eq 0 ]
}

@test "which ruby returns rbenv shim after init even with PATH modifications" {
    skip_if_missing "rbenv"

    if [ ! -x /opt/homebrew/bin/rbenv ] && [ ! -x /usr/local/bin/rbenv ]; then
        skip "rbenv not installed via Homebrew"
    fi

    # Start with a "broken" PATH similar to what system shell might have
    export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

    # Initialize version managers
    init_homebrew || true
    init_rbenv

    # Check which ruby
    local ruby_path
    ruby_path=$(command -v ruby 2>/dev/null || true)

    if [ -z "$ruby_path" ]; then
        skip "ruby not available"
    fi

    # Should be from rbenv shims, not /usr/bin/ruby
    [[ "$ruby_path" == *"/.rbenv/shims/ruby" ]]
}

@test "init_rbenv corrects PATH even when /usr/bin is first" {
    skip_if_missing "rbenv"

    if [ ! -x /opt/homebrew/bin/rbenv ] && [ ! -x /usr/local/bin/rbenv ]; then
        skip "rbenv not installed via Homebrew"
    fi

    # Simulate a shell that starts with /usr/bin first (like system default)
    export PATH="/usr/bin:/bin:/usr/sbin:/sbin"

    # Initialize Homebrew first (adds /opt/homebrew/bin to PATH)
    init_homebrew || true

    # Initialize rbenv - this should prepend shims
    init_rbenv

    # Verify shims come before /usr/bin
    run verify_path_order "rbenv"
    [ "$status" -eq 0 ]

    # Verify which ruby returns the shim
    local ruby_path
    ruby_path=$(command -v ruby 2>/dev/null || true)
    [[ "$ruby_path" == *"/.rbenv/shims/ruby" ]]
}

@test "double init_rbenv does not break PATH order" {
    skip_if_missing "rbenv"

    if [ ! -x /opt/homebrew/bin/rbenv ] && [ ! -x /usr/local/bin/rbenv ]; then
        skip "rbenv not installed via Homebrew"
    fi

    # First init
    init_homebrew || true
    init_rbenv

    # Simulate shell rc calling rbenv init again
    init_rbenv

    # PATH should still be correct
    run verify_path_order "rbenv"
    [ "$status" -eq 0 ]
}
