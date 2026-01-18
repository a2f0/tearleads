#!/usr/bin/env bash
# Common test helpers for Bats tests

# Get the tuxedo directory (tuxedo/tests/bats/helpers -> tuxedo)
TUXEDO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../" && pwd)"
LIB_DIR="$TUXEDO_DIR/lib"

# Source the library files
source_init_env_lib() {
    source "$LIB_DIR/init-env-lib.sh"
}

source_tuxedo_kill_lib() {
    source "$LIB_DIR/tuxedo-kill-lib.sh"
}

# Setup function - called before each test
setup() {
    # Save original PATH to restore after each test
    ORIGINAL_PATH="$PATH"

    # Create a temp directory for test artifacts
    TEST_TMPDIR=$(mktemp -d)
}

# Teardown function - called after each test
teardown() {
    # Restore original PATH
    export PATH="$ORIGINAL_PATH"

    # Clean up temp directory
    if [ -d "$TEST_TMPDIR" ]; then
        rm -rf "$TEST_TMPDIR"
    fi
}

# Assert that a path is in PATH before another path
# Usage: assert_path_before "/first/path" "/second/path"
assert_path_before() {
    local first="$1"
    local second="$2"
    local first_pos=-1
    local second_pos=-1
    local pos=0

    IFS=: read -ra path_parts <<< "$PATH"
    for p in "${path_parts[@]}"; do
        if [[ "$p" == "$first" && $first_pos -eq -1 ]]; then
            first_pos=$pos
        fi
        if [[ "$p" == "$second" && $second_pos -eq -1 ]]; then
            second_pos=$pos
        fi
        ((pos++))
    done

    if [[ $first_pos -eq -1 ]]; then
        echo "First path '$first' not found in PATH" >&2
        return 1
    fi
    if [[ $second_pos -eq -1 ]]; then
        # Second path not in PATH, so first is "before" it
        return 0
    fi
    if [[ $first_pos -lt $second_pos ]]; then
        return 0
    fi

    echo "Expected '$first' (pos $first_pos) before '$second' (pos $second_pos)" >&2
    return 1
}

# Assert that a path is in PATH
# Usage: assert_in_path "/some/path"
assert_in_path() {
    local expected="$1"
    case ":${PATH}:" in
        *:"$expected":*)
            return 0
            ;;
    esac
    echo "Expected '$expected' in PATH" >&2
    echo "PATH=$PATH" >&2
    return 1
}

# Assert that a path is NOT in PATH
# Usage: assert_not_in_path "/some/path"
assert_not_in_path() {
    local expected="$1"
    case ":${PATH}:" in
        *:"$expected":*)
            echo "Expected '$expected' NOT in PATH" >&2
            echo "PATH=$PATH" >&2
            return 1
            ;;
    esac
    return 0
}

# Create a mock executable in a temp directory
# Usage: create_mock_executable "/path/to/dir" "command_name"
create_mock_executable() {
    local dir="$1"
    local name="$2"
    mkdir -p "$dir"
    cat > "$dir/$name" << 'EOF'
#!/bin/sh
echo "mock $0"
EOF
    chmod +x "$dir/$name"
}

# Create a mock rbenv setup in temp directory
# Usage: setup_mock_rbenv "$TEST_TMPDIR"
setup_mock_rbenv() {
    local base="$1"
    local rbenv_dir="$base/.rbenv"

    mkdir -p "$rbenv_dir/bin" "$rbenv_dir/shims"

    # Create mock rbenv that outputs init script
    cat > "$rbenv_dir/bin/rbenv" << EOF
#!/bin/sh
if [ "\$1" = "init" ]; then
    echo 'export PATH="$rbenv_dir/shims:\${PATH}"'
fi
EOF
    chmod +x "$rbenv_dir/bin/rbenv"

    # Create mock ruby in shims
    create_mock_executable "$rbenv_dir/shims" "ruby"

    echo "$rbenv_dir"
}

# Create a mock pyenv setup in temp directory
# Usage: setup_mock_pyenv "$TEST_TMPDIR"
setup_mock_pyenv() {
    local base="$1"
    local pyenv_dir="$base/.pyenv"

    mkdir -p "$pyenv_dir/bin" "$pyenv_dir/shims"

    # Create mock pyenv that outputs init script
    cat > "$pyenv_dir/bin/pyenv" << EOF
#!/bin/sh
if [ "\$1" = "init" ]; then
    echo 'export PATH="$pyenv_dir/shims:\${PATH}"'
fi
EOF
    chmod +x "$pyenv_dir/bin/pyenv"

    # Create mock python in shims
    create_mock_executable "$pyenv_dir/shims" "python"

    echo "$pyenv_dir"
}

# Skip test if a command is not available
# Usage: skip_if_missing "command_name"
skip_if_missing() {
    local cmd="$1"
    if ! command -v "$cmd" >/dev/null 2>&1; then
        skip "$cmd not available"
    fi
}

# Get the position of a path component in PATH
# Usage: get_path_position "/some/path"
# Returns position (0-indexed) or -1 if not found
get_path_position() {
    local search="$1"
    local pos=0

    IFS=: read -ra path_parts <<< "$PATH"
    for p in "${path_parts[@]}"; do
        if [[ "$p" == "$search" ]]; then
            echo "$pos"
            return 0
        fi
        ((pos++))
    done

    echo "-1"
    return 1
}
