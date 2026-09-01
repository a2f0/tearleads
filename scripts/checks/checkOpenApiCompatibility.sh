#!/usr/bin/env sh

set -eu

OPENAPI_PATH=docs/openapi.json
ERROR_IGNORE_PATH=scripts/checks/openApiCompatibilityErrors.ignore
CUSTOM_IGNORE_PATH=scripts/checks/openApiCustomCompatibility.ignore

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

# Run compatibility checks the pinned oasdiff cannot currently express,
# including runtime-refinement direction and request maxItems tightening. The
# helper lives next to this script, not in $REPO_ROOT, so fixture repositories
# exercise the real implementation.
script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
base_spec_file=$(mktemp "${TMPDIR:-/tmp}/openapi-base.XXXXXX")
trap 'rm -f "$base_spec_file"' EXIT
git cat-file blob "$base_spec" >"$base_spec_file"

read_openapi_title() {
  bun -e '
    const spec = await Bun.file(Bun.argv[1]).json();
    const title = spec?.info?.title;
    if (typeof title !== "string") process.exit(2);
    process.stdout.write(title);
  ' "$1"
}

base_title=$(read_openapi_title "$base_spec_file") ||
  fail "cannot read info.title from $base_spec."
revision_title=$(read_openapi_title "$OPENAPI_PATH") ||
  fail "cannot read info.title from $OPENAPI_PATH."

# The move to Tearleads deliberately resets the wire contract. This condition
# is self-expiring: once the default branch carries the Tearleads title, future
# Tearleads-to-Tearleads comparisons continue through the normal compatibility
# checks below.
if [ "$revision_title" = "Tearleads Protocol API" ] &&
  [ "$base_title" != "$revision_title" ]; then
  echo "Skipping compatibility for the clean-break transition to $revision_title."
  rm -f "$base_spec_file"
  trap - EXIT
  exit 0
fi

if [ -f "$CUSTOM_IGNORE_PATH" ]; then
  bun "$script_dir/checkOpenApiRefinementCompatibility.ts" \
    "$base_spec_file" "$OPENAPI_PATH" "$CUSTOM_IGNORE_PATH"
else
  bun "$script_dir/checkOpenApiRefinementCompatibility.ts" \
    "$base_spec_file" "$OPENAPI_PATH"
fi
rm -f "$base_spec_file"
trap - EXIT

set -- breaking "$base_spec" "$OPENAPI_PATH" \
  --fail-on WARN \
  --allow-external-refs=false

if [ -f "$ERROR_IGNORE_PATH" ]; then
  ignore_entries=$(sed -e '/^[[:space:]]*#/d' -e '/^[[:space:]]*$/d' \
    "$ERROR_IGNORE_PATH")
  while IFS= read -r ignored_error || [ -n "$ignored_error" ]; do
    case "$ignored_error" in
      ''|'#'*) continue ;;
    esac
    reduced_ignore=$(mktemp "${TMPDIR:-/tmp}/openapi-ignore.XXXXXX")
    reduced_output=$(mktemp "${TMPDIR:-/tmp}/openapi-output.XXXXXX")
    trap 'rm -f "$reduced_ignore" "$reduced_output"' EXIT
    awk -v ignored_error="$ignored_error" '
      BEGIN { removed = 0 }
      !removed && $0 == ignored_error { removed = 1; next }
      { print }
    ' "$ERROR_IGNORE_PATH" >"$reduced_ignore"
    reduced_exit=0
    mise exec github:oasdiff/oasdiff -- oasdiff "$@" \
      --err-ignore "$reduced_ignore" \
      --warn-ignore "$reduced_ignore" \
      --format text --color never >"$reduced_output" 2>&1 ||
      reduced_exit=$?
    if [ "$reduced_exit" -eq 0 ]; then
      fail "unused OpenAPI compatibility ignore entry: $ignored_error"
    fi
    [ "$reduced_exit" -eq 1 ] || {
      cat "$reduced_output" >&2
      fail "oasdiff failed while validating the error ignore file."
    }
    rm -f "$reduced_ignore" "$reduced_output"
    trap - EXIT
  done <<EOF
$ignore_entries
EOF
  set -- "$@" --err-ignore "$ERROR_IGNORE_PATH" \
    --warn-ignore "$ERROR_IGNORE_PATH"
fi

if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  set -- "$@" --format githubactions
else
  set -- "$@" --format text --color never
fi

exec mise exec github:oasdiff/oasdiff -- oasdiff "$@"
