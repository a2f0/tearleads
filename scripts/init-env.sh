#!/bin/sh
# shellcheck disable=SC1091
# Initialize version managers for non-interactive shell environments
# Sourced by git hooks and tuxedo to ensure correct tool versions are used
# Note: Uses || true guards to work with set -e

# Determine script directory for sourcing library
_INIT_ENV_DIR=""
case "$0" in
    */*)
        _INIT_ENV_DIR=$(cd -- "$(dirname -- "$0")" && pwd -P)
        ;;
    *)
        # Sourced from another script - try to find our directory
        # shellcheck disable=SC3054 # BASH_SOURCE is bash-specific but we check for it first
        if [ -n "${BASH_SOURCE:-}" ]; then
            _INIT_ENV_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
        elif [ -f "${0%/*}/lib/init-env-lib.sh" ]; then
            _INIT_ENV_DIR="${0%/*}"
        fi
        ;;
esac

# Source library if available, otherwise use inline fallback
if [ -n "$_INIT_ENV_DIR" ] && [ -f "$_INIT_ENV_DIR/lib/init-env-lib.sh" ]; then
    . "$_INIT_ENV_DIR/lib/init-env-lib.sh"

    # Use library functions
    init_homebrew || true
    init_rbenv || true
    init_pyenv || true
    init_nvm || true
else
    # Fallback: inline implementation for backwards compatibility
    # (in case lib is missing or script is sourced in unusual way)

    # Homebrew (macOS) - must come first
    if [ "$(uname)" = Darwin ]; then
        [ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)" || true
        [ -x /usr/local/bin/brew ] && eval "$(/usr/local/bin/brew shellenv)" || true
    fi

    # rbenv - check Homebrew locations first, then git install
    if [ -x /opt/homebrew/bin/rbenv ]; then
        eval "$(/opt/homebrew/bin/rbenv init - sh)" || true
    elif [ -x /usr/local/bin/rbenv ]; then
        eval "$(/usr/local/bin/rbenv init - sh)" || true
    else
        [ -d "$HOME/.rbenv/bin" ] && export PATH="$HOME/.rbenv/bin${PATH:+:${PATH}}" || true
        command -v rbenv >/dev/null 2>&1 && eval "$(rbenv init - sh)" || true
    fi

    # pyenv - check Homebrew locations first, then git install
    export PYENV_ROOT="$HOME/.pyenv"
    if [ -x /opt/homebrew/bin/pyenv ]; then
        eval "$(/opt/homebrew/bin/pyenv init -)" || true
    elif [ -x /usr/local/bin/pyenv ]; then
        eval "$(/usr/local/bin/pyenv init -)" || true
    else
        [ -d "$PYENV_ROOT/bin" ] && export PATH="$PYENV_ROOT/bin${PATH:+:${PATH}}" || true
        command -v pyenv >/dev/null 2>&1 && eval "$(pyenv init -)" || true
    fi

    # nvm
    export NVM_DIR="$HOME/.nvm"
    [ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && . "/opt/homebrew/opt/nvm/nvm.sh" || true
    [ -s "/usr/local/opt/nvm/nvm.sh" ] && . "/usr/local/opt/nvm/nvm.sh" || true
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" || true
fi

unset _INIT_ENV_DIR
