#!/bin/sh

# This script can be sourced from anywhere to extend a shell to include
# paths for scripts in the repository.

prepend_path() {
  case ":$PATH:" in
    *":$1:"*) ;;
    *) PATH=$1${PATH:+:$PATH} ;;
  esac
}

if [ -n "${1:-}" ]; then
  repo_root=$1
elif [ -n "${tearleads_repo_root:-}" ]; then
  repo_root=$tearleads_repo_root
else
  repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
    echo "could not determine repo root; pass it explicitly:" >&2
    echo ". /path/to/repo/scripts/session.sh /path/to/repo" >&2
    if (return 0 2>/dev/null); then
      return 1
    fi
    exit 1
  }
fi

repo_script_paths="$repo_root/packages/api/scripts
$repo_root/packages/api-cli/scripts
$repo_root/packages/app-web/scripts
$repo_root/packages/app-electrobun/scripts
$repo_root/packages/sqlite-instance/scripts
$repo_root/packages/website/scripts
$repo_root/scripts
$repo_root/scripts/checks
$repo_root/scripts/git
$repo_root/scripts/testing
$repo_root/terraform/scripts"

while read -r script_path; do
  prepend_path "$script_path"
done <<EOF
$repo_script_paths
EOF


unset repo_root
unset script_path
unset tearleads_repo_root
unset -f prepend_path 2>/dev/null || true
