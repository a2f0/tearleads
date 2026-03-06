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
  case "$mode" in
    --staged)
      git diff --name-only --diff-filter=AM --cached
      ;;
    --from-upstream)
      local base_ref
      base_ref=$(
        git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null ||
          git rev-parse --verify origin/main 2>/dev/null ||
          git rev-parse --verify main 2>/dev/null
      )

      if [ -z "$base_ref" ]; then
        echo "checkProto: cannot determine base branch for comparison" >&2
        exit 1
      fi

      git diff --name-only --diff-filter=AM "$base_ref..HEAD"
      ;;
    --all)
      ;;
    *)
      usage
      ;;
  esac
}

has_proto_related_changes() {
  local path
  for path in "$@"; do
    case "$path" in
      proto/* | \
        packages/shared/src/gen/* | \
        scripts/lib/verifyProtoCodegenPlugins.ts | \
        scripts/checks/checkProto.sh | \
        package.json | \
        bun.lock | \
        bun.lockb | \
        pnpm-lock.yaml)
        return 0
        ;;
    esac
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
