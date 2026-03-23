#!/bin/sh

# This script can be sourced from anywhere to extend a shell to include
# paths for scripts in the repository.

prepend_path() {
  case ":$PATH:" in
    *":$1:"*) ;;
    *) PATH=$1${PATH:+:$PATH} ;;
  esac
}

if [ -n "$1" ]; then
  repo_root=$1
else
  repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
    echo "could not determine repo root; pass it explicitly:" >&2
    echo ". /path/to/repo/scripts/path.sh /path/to/repo" >&2
    if (return 0 2>/dev/null); then
      return 1
    fi
    exit 1
  }
fi

prepend_path "$repo_root/packages/api/scripts"
prepend_path "$repo_root/packages/app/scripts"
prepend_path "$repo_root/scripts"
prepend_path "$repo_root/scripts/git"
prepend_path "$repo_root/scripts/testing"

export PATH

unset repo_root
unset -f prepend_path 2>/dev/null || true
