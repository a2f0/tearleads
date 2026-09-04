#!/usr/bin/env bash
# Keep staging and production infrastructure behavior identical. Environment
# names and backend keys are the only expected textual differences.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
STAGING_STACK="$REPO_ROOT/terraform/stacks/staging/server"
PROD_STACK="$REPO_ROOT/terraform/stacks/prod/server"

normalize_tier_names() {
  sed \
    -e 's/STAGING_SSH_TARGET/ENVIRONMENT_SSH_TARGET/g' \
    -e 's/PRODUCTION_SSH_TARGET/ENVIRONMENT_SSH_TARGET/g' \
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
  local maintenance_verify_line

  verify_line="$(awk 'index($0, "test -x") { print NR; exit }' "$deploy_file")"
  stop_line="$(awk 'index($0, "systemctl stop tearleads-api") { print NR; exit }' "$deploy_file")"
  install_line="$(awk 'index($0, "mv -f") { print NR; exit }' "$deploy_file")"
  migration_line="$(awk 'index($0, "tearleads-api-cli migrate") { print NR; exit }' "$deploy_file")"
  start_line="$(awk 'index($0, "systemctl start tearleads-api") { print NR; exit }' "$deploy_file")"
  maintenance_verify_line="$(awk 'index($0, "Verifying API maintenance timers") { print NR; exit }' "$deploy_file")"

  if [ -z "$verify_line" ] || [ -z "$stop_line" ] || [ -z "$install_line" ] ||
    [ -z "$migration_line" ] || [ -z "$start_line" ] || [ -z "$maintenance_verify_line" ] ||
    [ "$verify_line" -ge "$stop_line" ] || [ "$stop_line" -ge "$install_line" ] ||
    [ "$install_line" -ge "$migration_line" ] || [ "$migration_line" -ge "$start_line" ] ||
    [ "$start_line" -ge "$maintenance_verify_line" ] ||
    ! grep -Fq 'systemctl is-enabled --quiet tearleads-blob-gc.timer' "$deploy_file" ||
    ! grep -Fq 'systemctl is-active --quiet tearleads-blob-gc.timer' "$deploy_file"; then
    echo "ERROR: API deploy must verify staged binaries, stop writers, install, migrate, restart, and verify blob GC in that order: $deploy_file" >&2
    return 1
  fi
}

assert_blob_gc_failure_alerting() {
  local maintenance_tasks="$REPO_ROOT/ansible/playbooks/tasks/apiMaintenance.yml"
  local secrets_loader="$REPO_ROOT/terraform/scripts/secretsEnv.sh"
  local healthcheck_env="$REPO_ROOT/ansible/playbooks/templates/etc/tearleads/blob-gc-healthcheck.env.j2"
  local healthcheck_client="$REPO_ROOT/ansible/playbooks/templates/usr/local/bin/tearleads-blob-gc-healthcheck.j2"
  local service_template="$REPO_ROOT/ansible/playbooks/templates/etc/systemd/system/tearleads-blob-gc.service.j2"
  local timer_template="$REPO_ROOT/ansible/playbooks/templates/etc/systemd/system/tearleads-blob-gc.timer.j2"
  local alert_template="$REPO_ROOT/ansible/playbooks/templates/etc/systemd/system/tearleads-maintenance-alert@.service.j2"
  local failure_target='OnFailure=tearleads-maintenance-alert@%n.service'

  if ! grep -Fq "$failure_target" "$service_template" ||
    ! grep -Fq "$failure_target" "$timer_template" ||
    ! grep -Fq 'tearleads-maintenance-alert@.service.j2' "$maintenance_tasks" ||
    ! grep -Fq 'Inspect blob GC systemd timer after enablement' "$maintenance_tasks" ||
    ! grep -Fq 'tearleads_blob_gc_timer.status.UnitFileState == "enabled"' "$maintenance_tasks" ||
    ! grep -Fq 'tearleads_blob_gc_timer.status.ActiveState == "active"' "$maintenance_tasks" ||
    ! grep -Fq 'blob-gc-healthcheck.env.j2' "$maintenance_tasks" ||
    ! grep -Fq "is match('^https://hc-ping[.]com/[A-Za-z0-9_-]+$')" "$maintenance_tasks" ||
    ! grep -Fq 'blob_gc_healthcheck_url_valid | bool' "$maintenance_tasks" ||
    ! grep -Fq 'BLOB_GC_HEALTHCHECK_URL={{ blob_gc_healthcheck_url | quote }}' "$healthcheck_env" ||
    ! grep -Fq "\${tier}.healthchecks.env" "$secrets_loader" ||
    ! grep -Fq 'name: curl' "$maintenance_tasks" ||
    ! grep -Fq 'tearleads-blob-gc-healthcheck.j2' "$maintenance_tasks" ||
    ! grep -Fq "printf 'url = \"%s\"\\n' \"\$endpoint\" | /usr/bin/curl" "$healthcheck_client" ||
    ! grep -Fq -- '--config -' "$healthcheck_client" ||
    ! grep -Fq 'EnvironmentFile=/etc/tearleads/blob-gc-healthcheck.env' "$service_template" ||
    ! grep -Fq 'ExecStartPre=-/usr/local/bin/tearleads-blob-gc-healthcheck start' "$service_template" ||
    ! grep -Fq 'ExecStartPost=-/usr/local/bin/tearleads-blob-gc-healthcheck success' "$service_template" ||
    ! grep -Fq 'User={{ server_user' "$alert_template" ||
    ! grep -Fq 'EnvironmentFile=-/etc/tearleads/blob-gc-healthcheck.env' "$alert_template" ||
    ! grep -Fq 'ExecStart=-/usr/local/bin/tearleads-blob-gc-healthcheck fail' "$alert_template" ||
    ! grep -Fxq 'CapabilityBoundingSet=' "$alert_template" ||
    ! grep -Fxq 'AmbientCapabilities=' "$alert_template" ||
    grep -Fq 'BLOB_GC_HEALTHCHECK_URL' "$service_template" ||
    grep -Fq 'BLOB_GC_HEALTHCHECK_URL' "$alert_template" ||
    ! grep -Fq -- '-p daemon.alert' "$alert_template" ||
    grep -Fq 'ConditionPathExists=' "$service_template"; then
    echo "ERROR: Blob GC must verify its timer state and report start, success, and failure heartbeats." >&2
    return 1
  fi
}

assert_blob_gc_healthcheck_url_validation() {
  local pattern='^https://hc-ping[.]com/[A-Za-z0-9_-]+$'

  if [[ ! "https://hc-ping.com/example-check_1" =~ $pattern ]] ||
    [[ "https://hc-ping.com/example-check_1/" =~ $pattern ]]; then
    echo "ERROR: Blob GC Healthchecks URLs must accept the canonical form and reject trailing slashes." >&2
    return 1
  fi
}

assert_superseded_timer_ordering() {
  local cleanup_file="$REPO_ROOT/ansible/playbooks/tasks/removeSupersededSymCryptDeployment.yml"
  local timer_stop_line
  local service_stop_line
  local unit_removal_line

  timer_stop_line="$(awk 'index($0, "Stop and disable superseded SymCrypt timers") { print NR; exit }' "$cleanup_file")"
  service_stop_line="$(awk 'index($0, "Stop and disable superseded SymCrypt services") { print NR; exit }' "$cleanup_file")"
  unit_removal_line="$(awk 'index($0, "Remove superseded SymCrypt systemd unit files") { print NR; exit }' "$cleanup_file")"

  if [ -z "$timer_stop_line" ] || [ -z "$service_stop_line" ] ||
    [ -z "$unit_removal_line" ] ||
    [ "$timer_stop_line" -ge "$service_stop_line" ] ||
    [ "$service_stop_line" -ge "$unit_removal_line" ]; then
    echo "ERROR: Superseded SymCrypt timers must stop before services and unit removal." >&2
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

assert_demo_static_ingress() {
  local app_template="$REPO_ROOT/ansible/playbooks/templates/etc/nginx/sites-available/app.conf.j2"
  local nginx_template="$REPO_ROOT/ansible/playbooks/templates/etc/nginx/nginx.conf.j2"
  local render_dir
  local rendered_app
  local app_server
  local demo_server

  render_dir="$(mktemp -d)"
  trap 'rm -rf "$render_dir"' RETURN
  rendered_app="$render_dir/app.conf"
  if ! ANSIBLE_LOCALHOST_WARNING=false \
    ANSIBLE_INVENTORY_UNPARSED_WARNING=false \
    ansible localhost --connection local \
      -m ansible.builtin.template \
      -a "src=$app_template dest=$rendered_app mode=0600" \
      -e '{"app_hostname":"app.example.test","app_demo_hostnames":["demo.example.test","demo.example.de"]}' \
      </dev/null >/dev/null 2>"$render_dir/ansible.stderr"; then
    sed -n '1,120p' "$render_dir/ansible.stderr" >&2
    return 1
  fi

  app_server="$(sed -n '/server_name app.example.test;/,/^}/p' "$rendered_app")"
  demo_server="$(sed -n '/server_name demo.example.test demo.example.de;/,/^}/p' "$rendered_app")"
  if ! grep -Fq 'root /var/www/app-web;' <<<"$app_server" ||
    ! grep -Fq 'root /var/www/app-demo;' <<<"$demo_server" ||
    ! grep -Fq "try_files \$uri \$uri/ /index.html;" <<<"$demo_server" ||
    ! grep -Fq 'listen 127.0.0.1:80 default_server;' "$nginx_template" ||
    ! grep -Fq 'return 444;' "$nginx_template"; then
    echo "ERROR: Every demo host must be served the app-demo bundle, and unrouted hosts must hit a refusing default server." >&2
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
assert_blob_gc_failure_alerting
assert_blob_gc_healthcheck_url_validation
assert_superseded_timer_ordering
assert_document_sync_ingress_cors
assert_demo_static_ingress

echo "Infrastructure tier parity passed."
