#!/usr/bin/env sh

set -eu

OPENAPI_PATH=docs/openapi.json
ERROR_IGNORE_PATH=scripts/checks/openApiCompatibilityErrors.ignore

fail() {
  echo "Error: $*" >&2
  exit 1
}

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) ||
  fail "OpenAPI compatibility must run inside a Git repository."

cd "$REPO_ROOT"

command -v mise >/dev/null 2>&1 ||
  fail "mise is unavailable. Install mise, then run 'mise install github:oasdiff/oasdiff'."

[ -f "$OPENAPI_PATH" ] || fail "$OPENAPI_PATH does not exist."

resolve_commit() {
  ref=$1
  commit=$(git rev-parse --verify "${ref}^{commit}" 2>/dev/null) ||
    fail "cannot resolve OpenAPI base '$ref'. Fetch it or set OPENAPI_BASE_REF to a local commit."
  printf '%s\n' "$commit"
}

if [ -n "${OPENAPI_BASE_REF:-}" ]; then
  base_description=$OPENAPI_BASE_REF
  base_commit=$(resolve_commit "$OPENAPI_BASE_REF")
elif [ -n "${GITHUB_BASE_REF:-}" ]; then
  base_description="origin/$GITHUB_BASE_REF"
  base_commit=$(resolve_commit "$base_description")
else
  base_description=origin/main
  base_tip=$(resolve_commit "$base_description")
  base_commit=$(git merge-base HEAD "$base_tip") ||
    fail "cannot find a merge base between HEAD and $base_description."
fi

base_spec="$base_commit:$OPENAPI_PATH"
git cat-file -e "$base_spec" 2>/dev/null ||
  fail "$OPENAPI_PATH does not exist at $base_description ($base_commit)."

echo "Checking $OPENAPI_PATH compatibility against $base_description ($base_commit)..."

command -v bun >/dev/null 2>&1 ||
  fail "bun is unavailable; it is required for the runtime-refinement check."

# oasdiff ignores x-tearleads-runtime-refinements, so tightening them must be
# caught separately. The helper lives next to this script, not in $REPO_ROOT,
# so fixture repositories exercise the real implementation.
script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
base_spec_file=$(mktemp "${TMPDIR:-/tmp}/openapi-base.XXXXXX")
trap 'rm -f "$base_spec_file"' EXIT
git cat-file blob "$base_spec" >"$base_spec_file"
bun "$script_dir/checkOpenApiRefinementCompatibility.ts" \
  "$base_spec_file" "$OPENAPI_PATH"
rm -f "$base_spec_file"
trap - EXIT

set -- breaking "$base_spec" "$OPENAPI_PATH" \
  --fail-on WARN \
  --allow-external-refs=false

if [ -f "$ERROR_IGNORE_PATH" ]; then
  set -- "$@" --err-ignore "$ERROR_IGNORE_PATH"
fi

if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  set -- "$@" --format githubactions
else
  set -- "$@" --format text --color never
fi

exec mise exec github:oasdiff/oasdiff -- oasdiff "$@"
