#!/bin/bash
# Load deployment env files atomically with strict shell semantics.

_source_env_file() {
  local env_file="$1"
  local encoded_env_entry
  local env_entry
  local env_name
  local env_snapshot
  local exported_name
  local -a exported_names_after=()
  local -a exported_names_before=()
  local import_status=0 source_status=0 xtrace_was_enabled=0

  if [[ ! -f "$env_file" ]]; then
    if [[ -e "$env_file" ]]; then
      echo "ERROR: $env_file exists but is not a regular file." >&2
      return 1
    fi
    echo "WARNING: $env_file not found. Environment variables must be set manually." >&2
    return 0
  fi

  while IFS= read -r env_name; do
    case "$env_name" in
      SHLVL | _) continue ;;
    esac
    exported_names_before+=("$env_name")
  done < <(compgen -e)

  if [[ "$-" == *x* ]]; then
    xtrace_was_enabled=1
    set +x
  fi
  if env_snapshot="$(
    bash -euo pipefail -c '
      set -a
      source "$1" >&2
      set +a
      tearleads_snapshot_names="$(compgen -e)"
      while IFS= read -r tearleads_snapshot_name; do
        printf "%q\n" "$tearleads_snapshot_name=${!tearleads_snapshot_name}"
      done <<< "$tearleads_snapshot_names"
    ' bash "$env_file"
  )"; then
    source_status=0
  else
    source_status=$?
  fi
  if [[ "$source_status" -ne 0 ]]; then
    if [[ "$xtrace_was_enabled" -eq 1 ]]; then
      set -x
    fi
    return "$source_status"
  fi

  while IFS= read -r encoded_env_entry; do
    [[ -z "$encoded_env_entry" ]] && continue
    eval "env_entry=${encoded_env_entry?}"
    env_name="${env_entry%%=*}"
    if [[ ! "$env_name" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
      continue
    fi
    case "$env_name" in
      SHLVL | _) continue ;;
    esac
    exported_names_after+=("$env_name")
    export "${env_entry?}" || {
      import_status=$?
      break
    }
  done <<< "$env_snapshot"
  if [[ "$import_status" -eq 0 ]]; then
    for env_name in "${exported_names_before[@]}"; do
      local name_is_present=0
      for exported_name in "${exported_names_after[@]}"; do
        if [[ "$env_name" == "$exported_name" ]]; then
          name_is_present=1
          break
        fi
      done
      if [[ "$name_is_present" -eq 0 ]]; then
        unset "$env_name" || {
          import_status=$?
          break
        }
      fi
    done
  fi
  if [[ "$xtrace_was_enabled" -eq 1 ]]; then
    set -x
  fi
  return "$import_status"
}

_source_optional_env_file() {
  local env_file="$1"

  if [[ ! -e "$env_file" ]]; then
    return 0
  fi

  _source_env_file "$env_file"
}

validate_tier_ssh_target_override() {
  local tier="$1"
  local tier_variable
  local tier_target

  case "$tier" in
    staging)
      tier_variable="STAGING_SSH_TARGET"
      tier_target="${STAGING_SSH_TARGET:-}"
      ;;
    prod)
      tier_variable="PRODUCTION_SSH_TARGET"
      tier_target="${PRODUCTION_SSH_TARGET:-}"
      ;;
    *)
      echo "ERROR: Unknown deployment tier: $tier" >&2
      return 1
      ;;
  esac

  if [[ -z "${SSH_TARGET:-}" ]]; then
    return 0
  fi

  if [[ -z "$tier_target" ]]; then
    echo "ERROR: SSH_TARGET is unsupported for tiered deployments." >&2
    echo "Use $tier_variable for the $tier deployment." >&2
    return 1
  fi

  if [[ "$SSH_TARGET" != "$tier_target" ]]; then
    echo "ERROR: SSH_TARGET conflicts with $tier_variable." >&2
    echo "Unset SSH_TARGET and use only $tier_variable for the $tier deployment." >&2
    return 1
  fi
}

load_secrets_env() {
  local tier="${1:-}"
  local secrets_dir
  local ssh_target_override=""
  case "$tier" in
    staging) ssh_target_override="${STAGING_SSH_TARGET:-}" ;;
    prod) ssh_target_override="${PRODUCTION_SSH_TARGET:-}" ;;
  esac
  secrets_dir="$(get_repo_root)/.secrets"

  if [[ -n "$tier" ]]; then
    validate_tier_ssh_target_override "$tier" || return 1
    unset SSH_TARGET
  fi

  _source_env_file "$secrets_dir/root.env" || return 1

  if [[ -n "$tier" ]]; then
    if [[ -n "${SSH_TARGET:-}" ]]; then
      unset SSH_TARGET
      echo "ERROR: $secrets_dir/root.env must not define SSH_TARGET." >&2
      echo "Set the target in $secrets_dir/${tier}.env or use the tier-specific override." >&2
      return 1
    fi
    _source_env_file "$secrets_dir/${tier}.env" || return 1
    _source_optional_env_file "$secrets_dir/${tier}.garage.env" || return 1
  fi

  if [[ -n "$ssh_target_override" ]]; then
    export SSH_TARGET="$ssh_target_override"
  fi
}
