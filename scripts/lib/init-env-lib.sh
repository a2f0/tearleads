#!/bin/sh
# shellcheck disable=SC1091
# Testable library functions for version manager initialization
# Sourced by init-env.sh and used in tests

# Prepend a directory to PATH if it exists and is not already in PATH
# Usage: path_prepend /path/to/dir
path_prepend() {
    dir="$1"
    [ -d "$dir" ] || return 1
    case ":${PATH}:" in
        *:"$dir":*) return 0 ;;  # Already in PATH
    esac
    export PATH="$dir${PATH:+:${PATH}}"
}

# Initialize Homebrew environment (macOS only)
# Sets up PATH, MANPATH, and INFOPATH for Homebrew
init_homebrew() {
    [ "$(uname)" = Darwin ] || return 1

    if [ -x /opt/homebrew/bin/brew ]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
        return 0
    elif [ -x /usr/local/bin/brew ]; then
        eval "$(/usr/local/bin/brew shellenv)"
        return 0
    fi
    return 1
}

# Initialize rbenv
# Handles both Homebrew and git-based installations
# Returns 0 if rbenv was initialized, 1 otherwise
init_rbenv() {
    # Homebrew installation (Apple Silicon)
    if [ -x /opt/homebrew/bin/rbenv ]; then
        eval "$(/opt/homebrew/bin/rbenv init - sh)" || true
        return 0
    fi

    # Homebrew installation (Intel Mac)
    if [ -x /usr/local/bin/rbenv ]; then
        eval "$(/usr/local/bin/rbenv init - sh)" || true
        return 0
    fi

    # Git-based installation
    if [ -d "$HOME/.rbenv/bin" ]; then
        path_prepend "$HOME/.rbenv/bin"
        eval "$(rbenv init - sh)" || true
        return 0
    fi

    # rbenv available in PATH (e.g., from Homebrew already initialized)
    if command -v rbenv >/dev/null 2>&1; then
        eval "$(rbenv init - sh)" || true
        return 0
    fi

    return 1
}

# Initialize pyenv
# Handles both Homebrew and git-based installations
# Returns 0 if pyenv was initialized, 1 otherwise
init_pyenv() {
    export PYENV_ROOT="${PYENV_ROOT:-$HOME/.pyenv}"

    # Homebrew installation (Apple Silicon)
    if [ -x /opt/homebrew/bin/pyenv ]; then
        eval "$(/opt/homebrew/bin/pyenv init -)"
        return 0
    fi

    # Homebrew installation (Intel Mac)
    if [ -x /usr/local/bin/pyenv ]; then
        eval "$(/usr/local/bin/pyenv init -)"
        return 0
    fi

    # Git-based installation
    if [ -d "$PYENV_ROOT/bin" ]; then
        path_prepend "$PYENV_ROOT/bin"
        eval "$(pyenv init -)"
        return 0
    fi

    # pyenv available in PATH
    if command -v pyenv >/dev/null 2>&1; then
        eval "$(pyenv init -)"
        return 0
    fi

    return 1
}

# Initialize nvm
# Handles Homebrew and manual installations
# Returns 0 if nvm was initialized, 1 otherwise
init_nvm() {
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

    # Homebrew installation (Apple Silicon)
    if [ -s /opt/homebrew/opt/nvm/nvm.sh ]; then
        . /opt/homebrew/opt/nvm/nvm.sh
        return 0
    fi

    # Homebrew installation (Intel Mac)
    if [ -s /usr/local/opt/nvm/nvm.sh ]; then
        . /usr/local/opt/nvm/nvm.sh
        return 0
    fi

    # Manual installation
    if [ -s "$NVM_DIR/nvm.sh" ]; then
        . "$NVM_DIR/nvm.sh"
        return 0
    fi

    return 1
}

# Verify that version manager shims come before system directories in PATH
# Usage: verify_path_order "rbenv"
# Returns 0 if shims are correctly positioned, 1 otherwise
verify_path_order() {
    manager="$1"
    shim_path=""

    case "$manager" in
        rbenv)
            shim_path="$HOME/.rbenv/shims"
            ;;
        pyenv)
            shim_path="${PYENV_ROOT:-$HOME/.pyenv}/shims"
            ;;
        *)
            return 1
            ;;
    esac

    # Check if shim path exists in PATH
    case ":${PATH}:" in
        *:"$shim_path":*)
            ;;
        *)
            return 1  # Shim path not in PATH
            ;;
    esac

    # Get position of shim path and /usr/bin in PATH
    shim_pos=""
    usr_bin_pos=""
    pos=0

    # Save and restore IFS
    old_ifs="$IFS"
    IFS=:
    for p in $PATH; do
        if [ "$p" = "$shim_path" ] && [ -z "$shim_pos" ]; then
            shim_pos=$pos
        fi
        if [ "$p" = "/usr/bin" ] && [ -z "$usr_bin_pos" ]; then
            usr_bin_pos=$pos
        fi
        pos=$((pos + 1))
    done
    IFS="$old_ifs"

    # If /usr/bin is not in PATH, shims are fine
    [ -z "$usr_bin_pos" ] && return 0

    # Shims must come before /usr/bin
    [ -n "$shim_pos" ] && [ "$shim_pos" -lt "$usr_bin_pos" ]
}

# Get the path to a command as resolved by the current PATH
# Usage: get_command_path ruby
get_command_path() {
    command -v "$1" 2>/dev/null
}

# Check if a command is provided by a shim (version manager)
# Usage: is_shim_command ruby
is_shim_command() {
    cmd="$1"
    cmd_path=$(get_command_path "$cmd")
    [ -n "$cmd_path" ] || return 1

    case "$cmd_path" in
        */.rbenv/shims/*|*/.pyenv/shims/*|*/.nvm/*)
            return 0
            ;;
    esac
    return 1
}
