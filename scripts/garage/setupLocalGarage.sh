#!/usr/bin/env sh
set -eu

ROOT_DIR="$(cd -- "$(dirname -- "$0")/../.." && pwd -P)"
GARAGE_DIR="${ROOT_DIR}/scripts/garage"
COMPOSE_FILE="${GARAGE_DIR}/docker-compose.yml"
API_ENV_LINK_PATH="${ROOT_DIR}/packages/api/.env"
GARAGE_CREDENTIALS_FILE="${GARAGE_DIR}/.s3-credentials.env"

GARAGE_RPC_SECRET="${GARAGE_RPC_SECRET:-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef}"
GARAGE_ADMIN_TOKEN="${GARAGE_ADMIN_TOKEN:-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef}"
GARAGE_KEY_NAME="${GARAGE_KEY_NAME:-vfs-blob-key}"
VFS_BLOB_S3_ACCESS_KEY_ID="${VFS_BLOB_S3_ACCESS_KEY_ID:-}"
VFS_BLOB_S3_SECRET_ACCESS_KEY="${VFS_BLOB_S3_SECRET_ACCESS_KEY:-}"
VFS_BLOB_S3_BUCKET="${VFS_BLOB_S3_BUCKET:-vfs-blobs}"
VFS_BLOB_S3_REGION="${VFS_BLOB_S3_REGION:-us-east-1}"
VFS_BLOB_S3_ENDPOINT="${VFS_BLOB_S3_ENDPOINT:-http://127.0.0.1:3900}"
VFS_BLOB_S3_FORCE_PATH_STYLE="${VFS_BLOB_S3_FORCE_PATH_STYLE:-true}"
VFS_BLOB_STORE_PROVIDER="${VFS_BLOB_STORE_PROVIDER:-s3}"

resolve_env_file_path() {
  link_path="$1"

  if [ -L "${link_path}" ]; then
    link_target="$(readlink "${link_path}")"
    case "${link_target}" in
      /*)
        printf '%s\n' "${link_target}"
        ;;
      *)
        abs_dir="$(cd -- "$(dirname "${link_path}")" && cd -- "$(dirname "${link_target}")" && pwd -P)"
        printf '%s/%s\n' "${abs_dir}" "$(basename "${link_target}")"
        ;;
    esac
    return
  fi

  printf '%s\n' "${link_path}"
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

compose_cmd() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    docker compose "$@"
    return
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
    return
  fi

  echo "Docker Compose is required (docker compose or docker-compose)." >&2
  exit 1
}

wait_for_garage_health() {
  retries=60
  while [ "$retries" -gt 0 ]; do
    status_code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3903/health" || true)"
    if [ "${status_code}" != "000" ]; then
      return
    fi
    retries=$((retries - 1))
    sleep 1
  done

  echo "Garage admin API did not become reachable." >&2
  exit 1
}

configure_garage_bucket() {
  garage_cli() {
    compose_cmd \
      -f "${COMPOSE_FILE}" \
      exec \
      -T \
      garage \
      /garage \
      -c \
      /etc/garage.toml \
      "$@"
  }

  read_or_create_credentials() {
    key_info_output=""
    key_name_to_create=""

    has_usable_secret() {
      case "${VFS_BLOB_S3_SECRET_ACCESS_KEY}" in
        "" | "redacted" | "(redacted)" | *redacted*)
          return 1
          ;;
      esac
      return 0
    }

    if [ -n "${VFS_BLOB_S3_ACCESS_KEY_ID}" ] && [ -n "${VFS_BLOB_S3_SECRET_ACCESS_KEY}" ]; then
      if has_usable_secret; then
        return
      fi
    fi

    if [ -f "${GARAGE_CREDENTIALS_FILE}" ]; then
      # shellcheck source=/dev/null
      . "${GARAGE_CREDENTIALS_FILE}"
    fi

    if [ -n "${VFS_BLOB_S3_ACCESS_KEY_ID}" ] && [ -n "${VFS_BLOB_S3_SECRET_ACCESS_KEY}" ]; then
      if has_usable_secret; then
        return
      fi
    fi

    key_name_to_create="${GARAGE_KEY_NAME}-$(date +%s)"
    key_info_output="$(garage_cli key create "${key_name_to_create}")"
    GARAGE_KEY_NAME="${key_name_to_create}"

    VFS_BLOB_S3_ACCESS_KEY_ID="$(printf '%s\n' "${key_info_output}" | awk -F': *' '/^Key ID:/ { print $2; exit }')"
    VFS_BLOB_S3_SECRET_ACCESS_KEY="$(printf '%s\n' "${key_info_output}" | awk -F': *' '/^Secret key:/ { print $2; exit }')"

    if [ -z "${VFS_BLOB_S3_ACCESS_KEY_ID}" ] || [ -z "${VFS_BLOB_S3_SECRET_ACCESS_KEY}" ] || [ "${VFS_BLOB_S3_SECRET_ACCESS_KEY}" = "(redacted)" ]; then
      echo "Failed to obtain Garage S3 credentials for key ${GARAGE_KEY_NAME}." >&2
      exit 1
    fi

    {
      printf 'GARAGE_KEY_NAME=%s\n' "${GARAGE_KEY_NAME}"
      printf 'VFS_BLOB_S3_ACCESS_KEY_ID=%s\n' "${VFS_BLOB_S3_ACCESS_KEY_ID}"
      printf 'VFS_BLOB_S3_SECRET_ACCESS_KEY=%s\n' "${VFS_BLOB_S3_SECRET_ACCESS_KEY}"
    } >"${GARAGE_CREDENTIALS_FILE}"
    chmod 600 "${GARAGE_CREDENTIALS_FILE}" 2>/dev/null || true
  }

  node_id="$(garage_cli node id | awk -F'@' 'NF>1 { print $1; exit }')"
  if [ -z "${node_id}" ]; then
    echo "Could not determine Garage node ID." >&2
    exit 1
  fi

  garage_cli layout assign -z dc1 -c 1G "${node_id}" || true

  attempts=20
  while [ "${attempts}" -gt 0 ]; do
    current_layout_version="$(garage_cli layout show | awk -F': *' '/^Current cluster layout version:/ { print $2; exit }')"
    if [ "${current_layout_version}" = "1" ]; then
      break
    fi
    garage_cli layout apply --version 1 >/dev/null 2>&1 || true
    attempts=$((attempts - 1))
    sleep 1
  done

  current_layout_version="$(garage_cli layout show | awk -F': *' '/^Current cluster layout version:/ { print $2; exit }')"
  if [ "${current_layout_version}" != "1" ]; then
    echo "Garage layout did not converge to version 1." >&2
    exit 1
  fi

  read_or_create_credentials

  garage_cli key info "${GARAGE_KEY_NAME}" >/dev/null 2>&1 || garage_cli key create "${GARAGE_KEY_NAME}" >/dev/null

  garage_cli bucket create "${VFS_BLOB_S3_BUCKET}" >/dev/null 2>&1 || true
  garage_cli bucket allow \
    --read \
    --write \
    --owner \
    "${VFS_BLOB_S3_BUCKET}" \
    --key \
    "${GARAGE_KEY_NAME}" \
    >/dev/null
}

main() {
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to verify Garage health." >&2
    exit 1
  fi

  mkdir -p "${GARAGE_DIR}/data/meta" "${GARAGE_DIR}/data/data"

  export GARAGE_RPC_SECRET
  export GARAGE_ADMIN_TOKEN
  export VFS_BLOB_S3_ACCESS_KEY_ID
  export VFS_BLOB_S3_SECRET_ACCESS_KEY
  export VFS_BLOB_S3_BUCKET

  compose_cmd -f "${COMPOSE_FILE}" up -d garage
  wait_for_garage_health
  configure_garage_bucket

  API_ENV_FILE="$(resolve_env_file_path "${API_ENV_LINK_PATH}")"
  mkdir -p "$(dirname "${API_ENV_FILE}")"
  if [ ! -f "${API_ENV_FILE}" ]; then
    cp "${ROOT_DIR}/packages/api/.env.example" "${API_ENV_FILE}"
    chmod 600 "${API_ENV_FILE}" 2>/dev/null || true
  fi

  for key in \
    VFS_BLOB_STORE_PROVIDER \
    VFS_BLOB_S3_BUCKET \
    VFS_BLOB_S3_REGION \
    VFS_BLOB_S3_ENDPOINT \
    VFS_BLOB_S3_ACCESS_KEY_ID \
    VFS_BLOB_S3_SECRET_ACCESS_KEY \
    VFS_BLOB_S3_FORCE_PATH_STYLE; do
    eval "value=\${${key}}"
    upsert_env_value "${API_ENV_FILE}" "${key}" "${value}"
  done

  echo "Garage local S3 is ready at ${VFS_BLOB_S3_ENDPOINT}."
  echo "Bucket: ${VFS_BLOB_S3_BUCKET}"
  echo "API env updated: ${API_ENV_FILE}"
}

main "$@"
