#!/bin/bash

hydrate_googleworkspace_auth() {
  local repo_root="$1"
  local secrets_dir="$repo_root/.secrets"
  local sa_key_path="${GOOGLE_APPLICATION_CREDENTIALS:-$secrets_dir/terraform-gworkspace-sa.json}"
  local admin_email_path="$secrets_dir/googleworkspace-admin-email"

  if [[ -z "${TF_VAR_googleworkspace_credentials:-}" && -f "$sa_key_path" ]]; then
    export TF_VAR_googleworkspace_credentials
    TF_VAR_googleworkspace_credentials="$(cat "$sa_key_path")"
    export GOOGLE_APPLICATION_CREDENTIALS="$sa_key_path"
  fi

  if [[ -z "${TF_VAR_googleworkspace_impersonated_user_email:-}" && -f "$admin_email_path" ]]; then
    local admin_email
    admin_email="$(tr -d '[:space:]' < "$admin_email_path")"
    if [[ -n "$admin_email" ]]; then
      export TF_VAR_googleworkspace_impersonated_user_email="$admin_email"
    fi
  fi

  if [[ -n "${TF_VAR_googleworkspace_credentials:-}" && -z "${TF_VAR_googleworkspace_service_account:-}" ]]; then
    local service_account
    service_account="$(printf '%s\n' "$TF_VAR_googleworkspace_credentials" \
      | sed -n 's/.*"client_email"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
      | head -1)"
    if [[ -n "$service_account" ]]; then
      export TF_VAR_googleworkspace_service_account="$service_account"
    fi
  fi
}
