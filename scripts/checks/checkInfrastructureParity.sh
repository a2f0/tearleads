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
  local verify_line
  local stop_line
  local install_line
  local migration_line
  local start_line

  verify_line="$(awk 'index($0, "test -x") { print NR; exit }' "$deploy_file")"
  stop_line="$(awk 'index($0, "systemctl stop tearleads-api") { print NR; exit }' "$deploy_file")"
  install_line="$(awk 'index($0, "mv -f") { print NR; exit }' "$deploy_file")"
  migration_line="$(awk 'index($0, "tearleads-api-cli migrate") { print NR; exit }' "$deploy_file")"
  start_line="$(awk 'index($0, "systemctl start tearleads-api") { print NR; exit }' "$deploy_file")"

  if [ -z "$verify_line" ] || [ -z "$stop_line" ] || [ -z "$install_line" ] ||
    [ -z "$migration_line" ] || [ -z "$start_line" ] ||
    [ "$verify_line" -ge "$stop_line" ] || [ "$stop_line" -ge "$install_line" ] ||
    [ "$install_line" -ge "$migration_line" ] || [ "$migration_line" -ge "$start_line" ]; then
    echo "ERROR: API deploy must verify staged binaries, stop writers, install, migrate, and restart in that order: $deploy_file" >&2
    return 1
  fi
}

assert_document_sync_ingress_cors() {
  local api_template="$REPO_ROOT/ansible/playbooks/templates/etc/nginx/sites-available/api.conf.j2"
  local render_dir
  local rendered_api
  local sync_location
  local sync_error_location
  local app_origin_rule="\"https://app.example.test\" \$http_origin;"
  local capacitor_origin_rule="\"https://localhost\" \$http_origin;"

  render_dir="$(mktemp -d)"
  trap 'rm -rf "$render_dir"' RETURN
  rendered_api="$render_dir/api.conf"
  if ! ANSIBLE_LOCALHOST_WARNING=false \
    ANSIBLE_INVENTORY_UNPARSED_WARNING=false \
    ansible localhost --connection local \
      -m ansible.builtin.template \
      -a "src=$api_template dest=$rendered_api mode=0600" \
      -e '{"api_hostname":"api.example.test","api_cors_origins":"https://app.example.test,,https://app.example.test, https://localhost","code_assist_enabled":false,"code_assist_port":3002}' \
      </dev/null >/dev/null 2>"$render_dir/ansible.stderr"; then
    sed -n '1,120p' "$render_dir/ansible.stderr" >&2
    return 1
  fi

  # `[+]` is a literal plus in both BSD and GNU basic regular expressions;
  # `\+` is a GNU extension meaning repetition and would miss nginx's `.+`.
  sync_location="$(sed -n '/location ~ \^\/documents\/\.[+]\/sync\$ {/,/^  }/p' "$rendered_api")"
  sync_error_location="$(sed -n '/location @document_sync_body_too_large {/,/^  }/p' "$rendered_api")"
  if [ "$(grep -Fc 'location ~ ^/documents/.+/sync$ {' "$rendered_api")" -ne 1 ] ||
    grep -Fq 'location ^~ /documents/' "$rendered_api" ||
    ! grep -Fq 'client_max_body_size 16M;' <<<"$sync_location" ||
    ! grep -Fq 'error_page 413 = @document_sync_body_too_large;' <<<"$sync_location" ||
    ! grep -Fq "add_header Access-Control-Allow-Origin \$document_sync_cors_origin always;" <<<"$sync_error_location" ||
    ! grep -Fq 'add_header Vary Origin always;' <<<"$sync_error_location" ||
    ! grep -Fq 'return 413' <<<"$sync_error_location" ||
    [ "$(grep -Fc "$app_origin_rule" "$rendered_api")" -ne 1 ] ||
    [ "$(grep -Fc "$capacitor_origin_rule" "$rendered_api")" -ne 1 ]; then
    echo "ERROR: Rendered document sync ingress must use an encoded-separator-safe 16 MiB route limit with JSON errors and the deduplicated API CORS allowlist." >&2
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
assert_document_sync_ingress_cors

echo "Infrastructure tier parity passed."
