#!/usr/bin/env sh

set -eu

fail() {
  echo "Error: $*" >&2
  exit 1
}

assert_contains() {
  value=$1
  expected=$2

  case "$value" in
    *"$expected"*) ;;
    *) fail "expected output to contain '$expected'." ;;
  esac
}

SOURCE_ROOT=$(git rev-parse --show-toplevel)
CHECK_SCRIPT=$SOURCE_ROOT/scripts/checks/checkOpenApiCompatibility.sh
FIXTURE_ROOT=$SOURCE_ROOT/scripts/checks/fixtures/openapiCompatibility
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/openapi-compatibility.XXXXXX")

trap 'rm -rf "$TEST_ROOT"' EXIT
trap 'exit 1' HUP INT TERM

git init --quiet --initial-branch=main "$TEST_ROOT"
git -C "$TEST_ROOT" config commit.gpgsign false
git -C "$TEST_ROOT" config user.email test@tearleads.com
git -C "$TEST_ROOT" config user.name "OpenAPI compatibility test"
mkdir -p "$TEST_ROOT/docs"
cp "$FIXTURE_ROOT/base.json" "$TEST_ROOT/docs/openapi.json"
git -C "$TEST_ROOT" add docs/openapi.json
git -C "$TEST_ROOT" commit --quiet -m "base contract"

base_commit=$(git -C "$TEST_ROOT" rev-parse HEAD)
git -C "$TEST_ROOT" update-ref refs/remotes/origin/main "$base_commit"

cp "$FIXTURE_ROOT/additive.json" "$TEST_ROOT/docs/openapi.json"
git -C "$TEST_ROOT" add docs/openapi.json
git -C "$TEST_ROOT" commit --quiet -m "add optional request property"
revision_commit=$(git -C "$TEST_ROOT" rev-parse HEAD)

fallback_output=$(
  cd "$TEST_ROOT"
  GITHUB_ACTIONS='' \
    MISE_CONFIG_FILE="$SOURCE_ROOT/.mise.toml" \
    "$CHECK_SCRIPT"
)
assert_contains "$fallback_output" "origin/main ($base_commit)"

explicit_output=$(
  cd "$TEST_ROOT"
  GITHUB_ACTIONS='' \
    MISE_CONFIG_FILE="$SOURCE_ROOT/.mise.toml" \
    OPENAPI_BASE_REF="$revision_commit" \
    "$CHECK_SCRIPT"
)
assert_contains "$explicit_output" "$revision_commit"

cp "$FIXTURE_ROOT/breaking.json" "$TEST_ROOT/docs/openapi.json"

if breaking_output=$(
  cd "$TEST_ROOT"
  GITHUB_ACTIONS='' \
    MISE_CONFIG_FILE="$SOURCE_ROOT/.mise.toml" \
    OPENAPI_BASE_REF="$revision_commit" \
    "$CHECK_SCRIPT" 2>&1
); then
  fail "a required request property was accepted as compatible."
else
  breaking_exit=$?
fi

[ "$breaking_exit" -eq 1 ] ||
  fail "expected oasdiff exit 1 for a breaking change, received $breaking_exit."
assert_contains "$breaking_output" "[request-property-became-required]"
assert_contains "$breaking_output" "name"

echo "OpenAPI compatibility regression fixtures passed."
