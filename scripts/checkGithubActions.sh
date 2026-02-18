#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 --all | --from-upstream" >&2
  exit 2
}

mode="${1:---all}"

if [ "$#" -gt 1 ]; then
  usage
fi

if [ "$mode" != "--all" ] && [ "$mode" != "--from-upstream" ]; then
  usage
fi

if ! command -v actionlint >/dev/null 2>&1; then
  echo "checkGithubActions: actionlint is not installed." >&2
  echo "Install with: brew install actionlint" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ "$mode" = "--all" ]; then
  actionlint -shellcheck=
  exit 0
fi

if upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null); then
  base_ref="$upstream"
elif git rev-parse --verify origin/main >/dev/null 2>&1; then
  base_ref="origin/main"
elif git rev-parse --verify main >/dev/null 2>&1; then
  base_ref="main"
else
  echo "checkGithubActions: cannot determine base branch for comparison" >&2
  exit 1
fi

mapfile -t workflow_files < <(
  git diff --name-only --diff-filter=AM "$base_ref..HEAD" -- '.github/workflows/*.yml' '.github/workflows/*.yaml'
)

if [ "${#workflow_files[@]}" -eq 0 ]; then
  exit 0
fi

actionlint -shellcheck= "${workflow_files[@]}"
