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

# CI exports OPENAPI_BASE_REF/GITHUB_BASE_REF for the real repository check;
# those refs cannot resolve inside the fixture repository, so clear them.
fallback_output=$(
  cd "$TEST_ROOT"
  GITHUB_ACTIONS='' \
    OPENAPI_BASE_REF='' \
    GITHUB_BASE_REF='' \
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

mkdir -p "$TEST_ROOT/scripts/checks"
printf '%s\n' 'POST /widgets has a stale ignored error' \
  >"$TEST_ROOT/scripts/checks/openApiCompatibilityErrors.ignore"
cp "$FIXTURE_ROOT/additive.json" "$TEST_ROOT/docs/openapi.json"

if unused_ignore_output=$(
  cd "$TEST_ROOT"
  GITHUB_ACTIONS='' \
    MISE_CONFIG_FILE="$SOURCE_ROOT/.mise.toml" \
    OPENAPI_BASE_REF="$revision_commit" \
    "$CHECK_SCRIPT" 2>&1
); then
  fail "an unused OpenAPI compatibility ignore entry was accepted."
fi
assert_contains "$unused_ignore_output" \
  "unused OpenAPI compatibility ignore entry"
rm "$TEST_ROOT/scripts/checks/openApiCompatibilityErrors.ignore"

cp "$FIXTURE_ROOT/maxLength.json" "$TEST_ROOT/docs/openapi.json"
if max_length_output=$(
  cd "$TEST_ROOT"
  GITHUB_ACTIONS='' \
    MISE_CONFIG_FILE="$SOURCE_ROOT/.mise.toml" \
    OPENAPI_BASE_REF="$base_commit" \
    "$CHECK_SCRIPT" 2>&1
); then
  fail "a request maxLength tightening was accepted without an ignore."
fi
assert_contains "$max_length_output" "[request-property-max-length-set]"
printf '%s\n' \
  "POST /widgets the \`name\` request property's maxLength was set to \`10\`" \
  >"$TEST_ROOT/scripts/checks/openApiCompatibilityErrors.ignore"
(
  cd "$TEST_ROOT"
  GITHUB_ACTIONS='' \
    MISE_CONFIG_FILE="$SOURCE_ROOT/.mise.toml" \
    OPENAPI_BASE_REF="$base_commit" \
    "$CHECK_SCRIPT"
)
rm "$TEST_ROOT/scripts/checks/openApiCompatibilityErrors.ignore"

cp "$FIXTURE_ROOT/maxItemsBase.json" "$TEST_ROOT/docs/openapi.json"
git -C "$TEST_ROOT" add docs/openapi.json
git -C "$TEST_ROOT" commit --quiet -m "add unbounded request array"
max_items_base_commit=$(git -C "$TEST_ROOT" rev-parse HEAD)
cp "$FIXTURE_ROOT/maxItems.json" "$TEST_ROOT/docs/openapi.json"

if max_items_output=$(
  cd "$TEST_ROOT"
  GITHUB_ACTIONS='' \
    MISE_CONFIG_FILE="$SOURCE_ROOT/.mise.toml" \
    OPENAPI_BASE_REF="$max_items_base_commit" \
    "$CHECK_SCRIPT" 2>&1
); then
  fail "a request maxItems tightening was accepted without an ignore."
fi
assert_contains "$max_items_output" "request maxItems constraint(s) tightened"
max_items_diagnostic=$(
  printf '%s\n' "$max_items_output" |
    sed -n 's/^  \(POST \/widgets: .*request maxItems.*\)$/\1/p'
)
[ -n "$max_items_diagnostic" ] ||
  fail "could not extract the maxItems compatibility diagnostic."
printf '%s\n' \
  "# #2096; remove after merge to main." \
  "$max_items_diagnostic" \
  >"$TEST_ROOT/scripts/checks/openApiCustomCompatibility.ignore"
(
  cd "$TEST_ROOT"
  GITHUB_ACTIONS='' \
    MISE_CONFIG_FILE="$SOURCE_ROOT/.mise.toml" \
    OPENAPI_BASE_REF="$max_items_base_commit" \
    "$CHECK_SCRIPT"
) || fail "an exact request maxItems compatibility ignore should pass."
rm "$TEST_ROOT/scripts/checks/openApiCustomCompatibility.ignore"

cp "$FIXTURE_ROOT/maxItemsRefBase.json" "$TEST_ROOT/docs/openapi.json"
git -C "$TEST_ROOT" add docs/openapi.json
git -C "$TEST_ROOT" commit --quiet -m "add referenced unbounded request array"
max_items_ref_base_commit=$(git -C "$TEST_ROOT" rev-parse HEAD)
cp "$FIXTURE_ROOT/maxItemsRef.json" "$TEST_ROOT/docs/openapi.json"

if max_items_ref_output=$(
  cd "$TEST_ROOT"
  GITHUB_ACTIONS='' \
    MISE_CONFIG_FILE="$SOURCE_ROOT/.mise.toml" \
    OPENAPI_BASE_REF="$max_items_ref_base_commit" \
    "$CHECK_SCRIPT" 2>&1
); then
  fail "a referenced request maxItems tightening was accepted."
fi
assert_contains "$max_items_ref_output" \
  "POST /widgets: 1 request maxItems constraint(s) tightened"

cp "$FIXTURE_ROOT/refinementAdded.json" "$TEST_ROOT/docs/openapi.json"

if refinement_output=$(
  cd "$TEST_ROOT"
  GITHUB_ACTIONS='' \
    OPENAPI_ALLOW_REFINEMENT_TIGHTENING='' \
    MISE_CONFIG_FILE="$SOURCE_ROOT/.mise.toml" \
    OPENAPI_BASE_REF="$revision_commit" \
    "$CHECK_SCRIPT" 2>&1
); then
  fail "an added runtime refinement was accepted as compatible."
else
  refinement_exit=$?
fi

[ "$refinement_exit" -eq 1 ] ||
  fail "expected exit 1 for an added refinement, received $refinement_exit."
assert_contains "$refinement_output" "request.unique-widget-name"

printf '%s\n' \
  "# #2096; remove after merge to main." \
  "POST /widgets: request refinement 'request.unique-widget-name' was added; existing clients were not rejected by it." \
  >"$TEST_ROOT/scripts/checks/openApiCustomCompatibility.ignore"
ignored_refinement_output=$(
  cd "$TEST_ROOT"
  GITHUB_ACTIONS='' \
    MISE_CONFIG_FILE="$SOURCE_ROOT/.mise.toml" \
    OPENAPI_BASE_REF="$revision_commit" \
    "$CHECK_SCRIPT" 2>&1
) || fail "an exact runtime-refinement compatibility ignore should pass."
assert_contains "$ignored_refinement_output" \
  "Ignored intentional custom compatibility change"

printf '%s\n' "POST /widgets: stale runtime refinement" \
  >"$TEST_ROOT/scripts/checks/openApiCustomCompatibility.ignore"
if unused_refinement_ignore_output=$(
  cd "$TEST_ROOT"
  GITHUB_ACTIONS='' \
    MISE_CONFIG_FILE="$SOURCE_ROOT/.mise.toml" \
    OPENAPI_BASE_REF="$revision_commit" \
    "$CHECK_SCRIPT" 2>&1
); then
  fail "an unused runtime-refinement compatibility ignore was accepted."
fi
assert_contains "$unused_refinement_ignore_output" \
  "unused custom OpenAPI compatibility ignore entry"
rm "$TEST_ROOT/scripts/checks/openApiCustomCompatibility.ignore"

allowed_output=$(
  cd "$TEST_ROOT"
  GITHUB_ACTIONS='' \
    MISE_CONFIG_FILE="$SOURCE_ROOT/.mise.toml" \
    OPENAPI_BASE_REF="$revision_commit" \
    OPENAPI_ALLOW_REFINEMENT_TIGHTENING=1 \
    "$CHECK_SCRIPT" 2>&1
) || fail "OPENAPI_ALLOW_REFINEMENT_TIGHTENING=1 should let the check pass."
assert_contains "$allowed_output" "Allowed by OPENAPI_ALLOW_REFINEMENT_TIGHTENING=1"

git -C "$TEST_ROOT" add docs/openapi.json
git -C "$TEST_ROOT" commit --quiet -m "add runtime refinement"
refinement_commit=$(git -C "$TEST_ROOT" rev-parse HEAD)
cp "$FIXTURE_ROOT/additive.json" "$TEST_ROOT/docs/openapi.json"

removal_output=$(
  cd "$TEST_ROOT"
  GITHUB_ACTIONS='' \
    MISE_CONFIG_FILE="$SOURCE_ROOT/.mise.toml" \
    OPENAPI_BASE_REF="$refinement_commit" \
    "$CHECK_SCRIPT" 2>&1
) || fail "removing a request refinement loosens the contract and must pass."
assert_contains "$removal_output" "$refinement_commit"

cp "$FIXTURE_ROOT/refinementResponse.json" "$TEST_ROOT/docs/openapi.json"

response_added_output=$(
  cd "$TEST_ROOT"
  GITHUB_ACTIONS='' \
    MISE_CONFIG_FILE="$SOURCE_ROOT/.mise.toml" \
    OPENAPI_BASE_REF="$revision_commit" \
    "$CHECK_SCRIPT" 2>&1
) || fail "adding a response refinement narrows server output and must pass."
assert_contains "$response_added_output" "$revision_commit"

git -C "$TEST_ROOT" add docs/openapi.json
git -C "$TEST_ROOT" commit --quiet -m "add response refinement"
response_commit=$(git -C "$TEST_ROOT" rev-parse HEAD)
cp "$FIXTURE_ROOT/additive.json" "$TEST_ROOT/docs/openapi.json"

if response_removed_output=$(
  cd "$TEST_ROOT"
  GITHUB_ACTIONS='' \
    OPENAPI_ALLOW_REFINEMENT_TIGHTENING='' \
    MISE_CONFIG_FILE="$SOURCE_ROOT/.mise.toml" \
    OPENAPI_BASE_REF="$response_commit" \
    "$CHECK_SCRIPT" 2>&1
); then
  fail "a removed response refinement was accepted as compatible."
else
  response_removed_exit=$?
fi

[ "$response_removed_exit" -eq 1 ] ||
  fail "expected exit 1 for a removed response refinement, received $response_removed_exit."
assert_contains "$response_removed_output" "response.widget-count-consistent"

cp "$FIXTURE_ROOT/breaking.json" "$TEST_ROOT/docs/openapi.json"
bun -e '
  const path = Bun.argv[1];
  const spec = await Bun.file(path).json();
  spec.info.title = "Tearleads Protocol API";
  await Bun.write(path, JSON.stringify(spec, null, 2) + "\n");
' "$TEST_ROOT/docs/openapi.json"

if brand_transition_output=$(
  cd "$TEST_ROOT"
  GITHUB_ACTIONS='' \
    MISE_CONFIG_FILE="$SOURCE_ROOT/.mise.toml" \
    OPENAPI_BASE_REF="$revision_commit" \
    "$CHECK_SCRIPT" 2>&1
); then
  fail "renaming the API must not bypass contract checks."
else
  brand_transition_exit=$?
fi
[ "$brand_transition_exit" -eq 1 ] ||
  fail "expected exit 1 for a breaking renamed contract, received $brand_transition_exit."
assert_contains "$brand_transition_output" "[request-property-became-required]"
assert_contains "$brand_transition_output" "name"

echo "OpenAPI compatibility regression fixtures passed."
