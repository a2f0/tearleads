#!/bin/bash
# shellcheck disable=SC1091
# Wrapper script for tuxedo screen sessions
# Starts the user's shell with version managers properly initialized
#
# The challenge: shell rc files often prepend to PATH, pushing rbenv/pyenv shims
# behind /usr/bin. We need init-env.sh to run AFTER rc files.
#
# Solution: Use ZDOTDIR (zsh) or custom rc (bash) to source a wrapper that:
# 1. Sources the user's real rc file
# 2. Sources init-env.sh to fix PATH order

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd -P)

# Export paths for rc file integration
export TUXEDO_INIT_ENV="$SCRIPT_DIR/init-env.sh"
export TUXEDO=1

# Detect the shell and use appropriate method
case "$SHELL" in
    */zsh)
        # Use ZDOTDIR to point to our custom zsh config
        # Our .zshrc sources user's .zshrc first, then init-env.sh
        # -i: interactive (reads .zshrc), -l: login shell
        export ZDOTDIR="$SCRIPT_DIR/config/zsh"
        exec zsh -i -l
        ;;
    */bash)
        # For bash: use --rcfile with a custom rc
        exec bash --rcfile "$SCRIPT_DIR/config/bashrc" -i
        ;;
    *)
        # Fallback: source init-env.sh and start the shell
        . "$SCRIPT_DIR/init-env.sh"
        exec "$SHELL" -i
        ;;
esac
