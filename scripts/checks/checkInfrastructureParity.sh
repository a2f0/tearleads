#!/usr/bin/env bash
# Keep staging and production infrastructure behavior identical. Environment
# names, backend keys, and staging's missing destroy guards are the only
# expected textual differences.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
STACKS="$REPO_ROOT/terraform/stacks"

normalize_tier_names() {
  sed \
    -e 's/Staging/Environment/g' \
    -e 's/Production/Environment/g' \
    -e 's/staging/environment/g' \
    -e 's/production/environment/g' \
    -e 's/prod/environment/g' \
    "$1"
}

# Staging stacks are disposable, so they omit the production destroy guards.
# Dropping the guard lines leaves uneven blank lines behind; squeeze them.
normalize_destroy_guards() {
  grep -v -E '^[[:space:]]*(lifecycle \{|prevent_destroy[[:space:]]*=.*|\})[[:space:]]*$' | cat -s
}

compare_tier_files() {
  local staging_file="$1"
  local prod_file="$2"
  local filter="${3:-cat}"

  if ! diff -u \
    --label "${staging_file#"$REPO_ROOT"/}" \
    --label "${prod_file#"$REPO_ROOT"/}" \
    <(normalize_tier_names "$staging_file" | "$filter") \
    <(normalize_tier_names "$prod_file" | "$filter"); then
    echo "ERROR: Staging and production infrastructure have drifted." >&2
    return 1
  fi
}

compare_stack() {
  local stack="$1"
  local filter="${2:-cat}"
  local staging_file
  for staging_file in "$STACKS/staging/$stack"/*.tf; do
    compare_tier_files "$staging_file" "$STACKS/prod/$stack/$(basename "$staging_file")" "$filter"
  done
  for prod_file in "$STACKS/prod/$stack"/*.tf; do
    if [[ ! -f "$STACKS/staging/$stack/$(basename "$prod_file")" ]]; then
      echo "ERROR: ${prod_file#"$REPO_ROOT"/} has no staging counterpart." >&2
      return 1
    fi
  done
}

# The Terraform interpolations below are literal text to find, not expansions.
# shellcheck disable=SC2016
assert_worker_names() {
  local tier="$1"
  local edge="$STACKS/$tier/edge/main.tf"
  local api_config="$REPO_ROOT/packages/api/wrangler.jsonc"
  local variant
  grep -Fq 'worker_name           = "tearleads-platform-api-${var.deployment_tier}"' "$edge" ||
    { echo "ERROR: $tier edge stack must attach the API hostname to the platform API Worker." >&2; return 1; }
  grep -Fq "\"name\": \"tearleads-platform-api-$tier\"" "$api_config" ||
    { echo "ERROR: packages/api/wrangler.jsonc must name the $tier Worker tearleads-platform-api-$tier." >&2; return 1; }
  for variant in app demo; do
    grep -Fq "worker_name           = \"tearleads-$variant-\${var.deployment_tier}\"" "$edge" ||
      { echo "ERROR: $tier edge stack must attach the $variant hostname to its asset Worker." >&2; return 1; }
    grep -Fq "\"name\": \"tearleads-$variant-$tier\"" "$REPO_ROOT/packages/app-web/wrangler.$variant.jsonc" ||
      { echo "ERROR: packages/app-web/wrangler.$variant.jsonc must name the $tier Worker tearleads-$variant-$tier." >&2; return 1; }
  done
}

assert_api_deploy_ordering() {
  local deploy_file="$REPO_ROOT/packages/api/scripts/deployApi.sh"
  local migration_line secrets_line publish_line

  migration_line="$(awk 'index($0, "bun src/index.ts migrate") { print NR; exit }' "$deploy_file")"
  secrets_line="$(awk 'index($0, "wrangler secret bulk") { print NR; exit }' "$deploy_file")"
  publish_line="$(awk 'index($0, "wrangler deploy --env") { print NR; exit }' "$deploy_file")"
  if [ -z "$migration_line" ] || [ -z "$secrets_line" ] || [ -z "$publish_line" ] ||
    [ "$migration_line" -ge "$secrets_line" ] || [ "$secrets_line" -ge "$publish_line" ]; then
    echo "ERROR: API deploy must migrate, sync secrets, then publish the Worker in that order: $deploy_file" >&2
    return 1
  fi
}

assert_tier_deploy_ordering() {
  local deploy_file="$1"
  local previous=0
  local step line
  for step in prepare-storage.sh prepare-postgres.sh deployApi.sh run-edge-stack.sh verifyApi.sh Website.sh AppWeb.sh; do
    line="$(awk -v needle="$step" 'index($0, needle) && index($0, "step_timings_run") { print NR; exit }' "$deploy_file")"
    if [ -z "$line" ] || [ "$line" -le "$previous" ]; then
      echo "ERROR: Tier deploy must run storage, database, API, edge, verification, website, then app-web: $deploy_file" >&2
      return 1
    fi
    previous="$line"
  done
}

compare_stack edge
compare_stack postgres normalize_destroy_guards
compare_tier_files "$REPO_ROOT/scripts/deployStaging.sh" "$REPO_ROOT/scripts/deployProduction.sh"
assert_worker_names staging
assert_worker_names prod
assert_api_deploy_ordering
assert_tier_deploy_ordering "$REPO_ROOT/scripts/deployStaging.sh"
assert_tier_deploy_ordering "$REPO_ROOT/scripts/deployProduction.sh"

echo "Infrastructure parity checks passed."
