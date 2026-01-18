# Tuxedo zprofile wrapper
# Sources user's .zprofile first

# Source user's real .zprofile if it exists
if [[ -f "$HOME/.zprofile" ]]; then
    _tuxedo_zdotdir="$ZDOTDIR"
    unset ZDOTDIR
    source "$HOME/.zprofile"
    export ZDOTDIR="$_tuxedo_zdotdir"
    unset _tuxedo_zdotdir
fi
