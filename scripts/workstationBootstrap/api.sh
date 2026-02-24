#!/usr/bin/env sh
set -eu

_api_resolve_env_file_path() {
  link_path="$1"

  if [ -L "${link_path}" ]; then
    link_target="$(readlink "${link_path}")"
    case "${link_target}" in
      /*)
        printf '%s\n' "${link_target}"
        ;;
      *)
        link_dir="$(dirname "${link_target}")"
        link_base="$(basename "${link_target}")"
        abs_dir="$(cd -- "$(dirname "${link_path}")/${link_dir}" && pwd -P)"
        printf '%s/%s\n' "${abs_dir}" "${link_base}"
        ;;
    esac
    return
  fi

  printf '%s\n' "${link_path}"
}

_api_read_env_value() {
  file_path="$1"
  key="$2"

  if [ ! -f "${file_path}" ]; then
    return
  fi

  awk -v key="${key}" '
    BEGIN { pattern = "^[[:space:]]*(export[[:space:]]+)?" key "=" }
    $0 ~ pattern {
      line = $0
      sub("^[^=]*=", "", line)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
      if (line ~ /^".*"$/ || line ~ /^\047.*\047$/) {
        line = substr(line, 2, length(line) - 2)
      }
      print line
      exit
    }
  ' "${file_path}"
}

_api_upsert_env_value() {
  file_path="$1"
  key="$2"
  value="$3"

  tmp_file="$(mktemp)"
  awk -v key="${key}" -v value="${value}" '
    BEGIN { found = 0 }
    $0 ~ "^[[:space:]]*(export[[:space:]]+)?" key "=" {
      print key "=" value
      found = 1
      next
    }
    { print }
    END {
      if (!found) {
        print key "=" value
      }
    }
  ' "${file_path}" >"${tmp_file}"
  mv "${tmp_file}" "${file_path}"
}

_api_generate_jwt_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi

  if command -v node >/dev/null 2>&1; then
    node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
    return
  fi

  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}

_api_ensure_env_file() {
  _ensure_link_path="$1"
  _ensure_example="$2"

  _ensure_env_file="$(_api_resolve_env_file_path "${_ensure_link_path}")"
  mkdir -p "$(dirname "${_ensure_env_file}")"

  if [ ! -f "${_ensure_env_file}" ]; then
    if [ ! -f "${_ensure_example}" ]; then
      echo "Missing env example at ${_ensure_example}." >&2
      return 1
    fi
    cp "${_ensure_example}" "${_ensure_env_file}"
    chmod 600 "${_ensure_env_file}" 2>/dev/null || true
    echo "Created env file at ${_ensure_env_file}."
  fi

  printf '%s\n' "${_ensure_env_file}"
}

_api_set_vfs_defaults() {
  _vfs_env_file="$1"

  while IFS='=' read -r key value; do
    [ -n "${key}" ] || continue
    current_value="$(_api_read_env_value "${_vfs_env_file}" "${key}" || true)"
    if [ -z "${current_value}" ]; then
      _api_upsert_env_value "${_vfs_env_file}" "${key}" "${value}"
    fi
  done <<EOF
VFS_BLOB_STORE_PROVIDER=s3
VFS_BLOB_S3_BUCKET=vfs-blobs
VFS_BLOB_S3_REGION=us-east-1
VFS_BLOB_S3_ENDPOINT=http://127.0.0.1:3900
VFS_BLOB_S3_ACCESS_KEY_ID=vfs-blob-key
VFS_BLOB_S3_SECRET_ACCESS_KEY=vfs-blob-secret-local-dev
VFS_BLOB_S3_FORCE_PATH_STYLE=true
EOF
}

setup_api_dev_env() {
  api_dir="${REPO_ROOT}/packages/api"
  smtp_dir="${REPO_ROOT}/packages/smtp-listener"
  secrets_env_file="${REPO_ROOT}/.secrets/dev.env"

  api_env_file="$(_api_ensure_env_file "${api_dir}/.env" "${api_dir}/.env.example")" || return 1

  current_jwt_secret="$(_api_read_env_value "${api_env_file}" "JWT_SECRET" || true)"
  if [ -z "${current_jwt_secret}" ] || [ "${current_jwt_secret}" = "your-jwt-secret" ]; then
    generated_jwt_secret="$(_api_generate_jwt_secret)"
    _api_upsert_env_value "${api_env_file}" "JWT_SECRET" "${generated_jwt_secret}"
    echo "Initialized JWT_SECRET in ${api_env_file}."
  fi

  current_openrouter_key="$(_api_read_env_value "${api_env_file}" "OPENROUTER_API_KEY" || true)"
  if [ -z "${current_openrouter_key}" ] || [ "${current_openrouter_key}" = "your-openrouter-api-key" ]; then
    openrouter_from_secrets="$(_api_read_env_value "${secrets_env_file}" "OPENROUTER_API_KEY" || true)"
    if [ -n "${openrouter_from_secrets}" ]; then
      _api_upsert_env_value "${api_env_file}" "OPENROUTER_API_KEY" "${openrouter_from_secrets}"
      echo "Initialized OPENROUTER_API_KEY from .secrets/dev.env."
    fi
  fi

  _api_set_vfs_defaults "${api_env_file}"

  # --- smtp-listener env bootstrap ---

  smtp_env_file="$(_api_ensure_env_file "${smtp_dir}/.env" "${smtp_dir}/.env.example")" || return 1

  _api_set_vfs_defaults "${smtp_env_file}"
}
