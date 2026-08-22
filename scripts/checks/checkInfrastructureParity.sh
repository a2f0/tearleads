#!/usr/bin/env bash
# Keep staging and production infrastructure behavior identical. Environment
# names and backend keys are the only expected textual differences.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
STAGING_STACK="$REPO_ROOT/terraform/stacks/staging/server"
PROD_STACK="$REPO_ROOT/terraform/stacks/prod/server"

normalize_tier_names() {
  sed \
    -e 's/Staging/Environment/g' \
    -e 's/Production/Environment/g' \
    -e 's/staging/environment/g' \
    -e 's/production/environment/g' \
    -e 's/prod/environment/g' \
    "$1"
}

compare_tier_files() {
  local staging_file="$1"
  local prod_file="$2"

  if ! diff -u \
    --label "${staging_file#"$REPO_ROOT"/}" \
    --label "${prod_file#"$REPO_ROOT"/}" \
    <(normalize_tier_names "$staging_file") \
    <(normalize_tier_names "$prod_file"); then
    echo "ERROR: Staging and production infrastructure have drifted." >&2
    return 1
  fi
}

assert_api_deploy_ordering() {
  local deploy_file="$1"
  local stop_line
  local migration_line
  local start_line

  stop_line="$(awk 'index($0, "systemctl stop symcrypt-api") { print NR; exit }' "$deploy_file")"
  migration_line="$(awk 'index($0, "symcrypt-api-cli migrate") { print NR; exit }' "$deploy_file")"
  start_line="$(awk 'index($0, "systemctl start symcrypt-api") { print NR; exit }' "$deploy_file")"

  if [ -z "$stop_line" ] || [ -z "$migration_line" ] || [ -z "$start_line" ] ||
    [ "$stop_line" -ge "$migration_line" ] || [ "$migration_line" -ge "$start_line" ]; then
    echo "ERROR: API deploy must stop database writers before migration and restart them afterward: $deploy_file" >&2
    return 1
  fi
}

list_stack_files() {
  local stack_dir="$1"

  {
    find "$stack_dir" -maxdepth 1 -type f -name '*.tf' -exec basename {} \;
    find "$stack_dir/scripts" -maxdepth 1 -type f -name '*.sh' -exec basename {} \; |
      sed 's#^#scripts/#'
  } | sort
}

if ! diff -u \
  --label "terraform/stacks/staging/server/files" \
  --label "terraform/stacks/prod/server/files" \
  <(list_stack_files "$STAGING_STACK") \
  <(list_stack_files "$PROD_STACK"); then
  echo "ERROR: Staging and production stack file lists have drifted." >&2
  exit 1
fi

while IFS= read -r relative_path; do
  compare_tier_files \
    "$STAGING_STACK/$relative_path" \
    "$PROD_STACK/$relative_path"
done < <(list_stack_files "$STAGING_STACK")

compare_tier_files \
  "$REPO_ROOT/ansible/scripts/run-server-staging.sh" \
  "$REPO_ROOT/ansible/scripts/run-server-prod.sh"

compare_tier_files \
  "$REPO_ROOT/scripts/deployStaging.sh" \
  "$REPO_ROOT/scripts/deployProduction.sh"

compare_tier_files \
  "$REPO_ROOT/packages/api/scripts/deployStagingApi.sh" \
  "$REPO_ROOT/packages/api/scripts/deployProductionApi.sh"

assert_api_deploy_ordering \
  "$REPO_ROOT/packages/api/scripts/deployStagingApi.sh"
assert_api_deploy_ordering \
  "$REPO_ROOT/packages/api/scripts/deployProductionApi.sh"

echo "Infrastructure tier parity passed."
