#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$SCRIPT_PATH")" && pwd)"
REPO_ROOT="$(CDPATH='' cd -- "$SCRIPT_DIR/../.." && pwd)"
PM_SCRIPT="$REPO_ROOT/scripts/tooling/pm.sh"
cd "$REPO_ROOT"

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
        packages/api-client/src/protoConsumerCompileFixture.ts | \
        packages/api-client/tsconfig.protoConsumerCompile.json | \
        scripts/lib/verifyProtoCodegenPlugins.ts | \
        scripts/lib/pruneStaleGeneratedProtoVersions.ts | \
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

if ! sh "$PM_SCRIPT" which >/dev/null 2>&1; then
  echo "checkProto: unable to resolve package manager (pnpm or bun)." >&2
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

sh "$PM_SCRIPT" run protoLint
sh "$PM_SCRIPT" exec buf breaking proto --against '.git#ref=origin/main,subdir=proto'
sh "$PM_SCRIPT" run protoGenerate
node --experimental-strip-types scripts/checks/checkProtoCodegenParity.ts
sh "$PM_SCRIPT" --filter @tearleads/shared build
sh "$PM_SCRIPT" --filter @tearleads/api-client exec tsc -p tsconfig.protoConsumerCompile.json --noEmit
