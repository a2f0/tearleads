#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 --staged | --from-upstream | --all" >&2
  exit 2
}

if [ "$#" -ne 1 ]; then
  usage
fi

mode="$1"

collect_files() {
  if [ "$mode" = "--staged" ]; then
    git diff --name-only --diff-filter=AM --cached
    return
  fi

  if [ "$mode" = "--from-upstream" ]; then
    local base_ref

    if upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null); then
      base_ref="$upstream"
    elif git rev-parse --verify origin/main >/dev/null 2>&1; then
      base_ref="origin/main"
    elif git rev-parse --verify main >/dev/null 2>&1; then
      base_ref="main"
    else
      echo "checkProto: cannot determine base branch for comparison" >&2
      exit 1
    fi

    git diff --name-only --diff-filter=AM "$base_ref..HEAD"
    return
  fi

  if [ "$mode" = "--all" ]; then
    return
  fi

  usage
}

has_proto_related_changes() {
  local path
  for path in "$@"; do
    if [[ "$path" == proto/* || "$path" == packages/shared/src/gen/* || "$path" == scripts/lib/verifyProtoCodegenPlugins.ts || "$path" == package.json || "$path" == pnpm-lock.yaml ]]; then
      return 0
    fi
  done
  return 1
}

if ! command -v pnpm >/dev/null 2>&1; then
  echo "checkProto: pnpm is required." >&2
  exit 1
fi

if [ "$mode" != "--all" ]; then
  mapfile -t files < <(collect_files)
  if [ "${#files[@]}" -eq 0 ]; then
    exit 0
  fi
  if ! has_proto_related_changes "${files[@]}"; then
    exit 0
  fi
fi

if ! git rev-parse --verify origin/main >/dev/null 2>&1; then
  git fetch --no-tags --depth=1 origin main:refs/remotes/origin/main
fi

pnpm protoLint
pnpm exec buf breaking proto --against '.git#ref=origin/main,subdir=proto'
pnpm protoGenerate

if [ -n "$(git status --porcelain -- packages/shared/src/gen)" ]; then
  echo "checkProto: generated proto artifacts are out of date." >&2
  echo "Run 'pnpm protoGenerate' and commit changes under packages/shared/src/gen." >&2
  git status --short -- packages/shared/src/gen >&2
  exit 1
fi
