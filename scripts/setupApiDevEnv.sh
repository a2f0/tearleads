#!/usr/bin/env sh
set -eu

ROOT_DIR="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
API_DIR="${ROOT_DIR}/packages/api"
EXAMPLE_ENV_FILE="${API_DIR}/.env.example"
API_ENV_LINK_PATH="${API_DIR}/.env"
SMTP_DIR="${ROOT_DIR}/packages/smtp-listener"
SMTP_EXAMPLE_ENV_FILE="${SMTP_DIR}/.env.example"
SMTP_ENV_LINK_PATH="${SMTP_DIR}/.env"
SECRETS_ENV_FILE="${ROOT_DIR}/.secrets/env.dev"

resolve_env_file_path() {
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

read_env_value() {
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

upsert_env_value() {
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

generate_jwt_secret() {
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

API_ENV_FILE="$(resolve_env_file_path "${API_ENV_LINK_PATH}")"
mkdir -p "$(dirname "${API_ENV_FILE}")"

if [ ! -f "${API_ENV_FILE}" ]; then
  if [ ! -f "${EXAMPLE_ENV_FILE}" ]; then
    echo "Missing API env example at ${EXAMPLE_ENV_FILE}." >&2
    exit 1
  fi
  cp "${EXAMPLE_ENV_FILE}" "${API_ENV_FILE}"
  chmod 600 "${API_ENV_FILE}" 2>/dev/null || true
  echo "Created API env file at ${API_ENV_FILE}."
fi

current_jwt_secret="$(read_env_value "${API_ENV_FILE}" "JWT_SECRET" || true)"
if [ -z "${current_jwt_secret}" ] || [ "${current_jwt_secret}" = "your-jwt-secret" ]; then
  generated_jwt_secret="$(generate_jwt_secret)"
  upsert_env_value "${API_ENV_FILE}" "JWT_SECRET" "${generated_jwt_secret}"
  echo "Initialized JWT_SECRET in ${API_ENV_FILE}."
fi

current_openrouter_key="$(read_env_value "${API_ENV_FILE}" "OPENROUTER_API_KEY" || true)"
if [ -z "${current_openrouter_key}" ] || [ "${current_openrouter_key}" = "your-openrouter-api-key" ]; then
  openrouter_from_secrets="$(read_env_value "${SECRETS_ENV_FILE}" "OPENROUTER_API_KEY" || true)"
  if [ -n "${openrouter_from_secrets}" ]; then
    upsert_env_value "${API_ENV_FILE}" "OPENROUTER_API_KEY" "${openrouter_from_secrets}"
    echo "Initialized OPENROUTER_API_KEY from .secrets/env.dev."
  fi
fi

while IFS='=' read -r key value; do
  [ -n "${key}" ] || continue
  current_value="$(read_env_value "${API_ENV_FILE}" "${key}" || true)"
  if [ -z "${current_value}" ]; then
    upsert_env_value "${API_ENV_FILE}" "${key}" "${value}"
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

# --- smtp-listener env bootstrap ---

SMTP_ENV_FILE="$(resolve_env_file_path "${SMTP_ENV_LINK_PATH}")"
mkdir -p "$(dirname "${SMTP_ENV_FILE}")"

if [ ! -f "${SMTP_ENV_FILE}" ]; then
  if [ ! -f "${SMTP_EXAMPLE_ENV_FILE}" ]; then
    echo "Missing smtp-listener env example at ${SMTP_EXAMPLE_ENV_FILE}." >&2
    exit 1
  fi
  cp "${SMTP_EXAMPLE_ENV_FILE}" "${SMTP_ENV_FILE}"
  chmod 600 "${SMTP_ENV_FILE}" 2>/dev/null || true
  echo "Created smtp-listener env file at ${SMTP_ENV_FILE}."
fi

while IFS='=' read -r key value; do
  [ -n "${key}" ] || continue
  current_value="$(read_env_value "${SMTP_ENV_FILE}" "${key}" || true)"
  if [ -z "${current_value}" ]; then
    upsert_env_value "${SMTP_ENV_FILE}" "${key}" "${value}"
  fi
done <<SMTP_EOF
VFS_BLOB_STORE_PROVIDER=s3
VFS_BLOB_S3_BUCKET=vfs-blobs
VFS_BLOB_S3_REGION=us-east-1
VFS_BLOB_S3_ENDPOINT=http://127.0.0.1:3900
VFS_BLOB_S3_ACCESS_KEY_ID=vfs-blob-key
VFS_BLOB_S3_SECRET_ACCESS_KEY=vfs-blob-secret-local-dev
VFS_BLOB_S3_FORCE_PATH_STYLE=true
SMTP_EOF
