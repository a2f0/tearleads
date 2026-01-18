# Tuxedo zshrc wrapper
# Sources user's .zshrc first, then init-env.sh to ensure version managers work

# Source user's real .zshrc if it exists
if [[ -f "$HOME/.zshrc" ]]; then
    # Temporarily unset ZDOTDIR so user's .zshrc doesn't recurse
    _tuxedo_zdotdir="$ZDOTDIR"
    unset ZDOTDIR
    source "$HOME/.zshrc"
    export ZDOTDIR="$_tuxedo_zdotdir"
    unset _tuxedo_zdotdir
fi

# Source init-env.sh AFTER user's rc to ensure shims are first in PATH
if [[ -f "$TUXEDO_INIT_ENV" ]]; then
    source "$TUXEDO_INIT_ENV"
fi
