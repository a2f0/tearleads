#!/bin/sh
# Resolve repo root from the current working directory when possible.

SCRIPT_REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
if command -v git >/dev/null 2>&1 && GIT_ROOT=$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null); then
    REPO_ROOT="$GIT_ROOT"
else
    REPO_ROOT="$SCRIPT_REPO_ROOT"
fi
