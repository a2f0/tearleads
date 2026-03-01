#!/usr/bin/env sh
set -eu

ROOT_DIR="$(cd -- "$(dirname -- "$0")/../.." && pwd -P)"
LOCALSTACK_DIR="${ROOT_DIR}/scripts/localstack"
COMPOSE_FILE="${LOCALSTACK_DIR}/docker-compose.yml"
DEV_ENV_FILE="${ROOT_DIR}/.secrets/dev.env"

read_env_value() {
  file_path="$1"
  key="$2"

  if [ ! -f "${file_path}" ]; then
    return 1
  fi

  awk -v key="${key}" '
    $0 ~ "^[[:space:]]*(export[[:space:]]+)?" key "[[:space:]]*=" {
      line = $0
      sub(/^[[:space:]]*(export[[:space:]]+)?/, "", line)
      sub("^" key "[[:space:]]*=", "", line)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
      if (line ~ /^".*"$/ || line ~ /^\047.*\047$/) {
        line = substr(line, 2, length(line) - 2)
      }
      print line
      found = 1
      exit
    }
    END {
      if (!found) {
        exit 1
      }
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

sync_dev_env_values() {
  mkdir -p "$(dirname "${DEV_ENV_FILE}")"
  if [ ! -f "${DEV_ENV_FILE}" ]; then
    : > "${DEV_ENV_FILE}"
    chmod 600 "${DEV_ENV_FILE}" 2>/dev/null || true
    echo "Created ${DEV_ENV_FILE}."
  fi

  VFS_BLOB_STORE_PROVIDER_VALUE="${VFS_BLOB_STORE_PROVIDER:-s3}"
  VFS_BLOB_S3_BUCKET_VALUE="${VFS_BLOB_S3_BUCKET:-vfs-blobs}"
  VFS_BLOB_S3_REGION_VALUE="${VFS_BLOB_S3_REGION:-us-east-1}"
  VFS_BLOB_S3_ENDPOINT_VALUE="${VFS_BLOB_S3_ENDPOINT:-http://127.0.0.1:4566}"
  VFS_BLOB_S3_ACCESS_KEY_ID_VALUE="${VFS_BLOB_S3_ACCESS_KEY_ID:-test}"
  VFS_BLOB_S3_SECRET_ACCESS_KEY_VALUE="${VFS_BLOB_S3_SECRET_ACCESS_KEY:-test}"
  VFS_BLOB_S3_FORCE_PATH_STYLE_VALUE="${VFS_BLOB_S3_FORCE_PATH_STYLE:-true}"

  upsert_env_value "${DEV_ENV_FILE}" "VFS_BLOB_STORE_PROVIDER" "${VFS_BLOB_STORE_PROVIDER_VALUE}"
  upsert_env_value "${DEV_ENV_FILE}" "VFS_BLOB_S3_BUCKET" "${VFS_BLOB_S3_BUCKET_VALUE}"
  upsert_env_value "${DEV_ENV_FILE}" "VFS_BLOB_S3_REGION" "${VFS_BLOB_S3_REGION_VALUE}"
  upsert_env_value "${DEV_ENV_FILE}" "VFS_BLOB_S3_ENDPOINT" "${VFS_BLOB_S3_ENDPOINT_VALUE}"
  upsert_env_value "${DEV_ENV_FILE}" "VFS_BLOB_S3_ACCESS_KEY_ID" "${VFS_BLOB_S3_ACCESS_KEY_ID_VALUE}"
  upsert_env_value "${DEV_ENV_FILE}" "VFS_BLOB_S3_SECRET_ACCESS_KEY" "${VFS_BLOB_S3_SECRET_ACCESS_KEY_VALUE}"
  upsert_env_value "${DEV_ENV_FILE}" "VFS_BLOB_S3_FORCE_PATH_STYLE" "${VFS_BLOB_S3_FORCE_PATH_STYLE_VALUE}"
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

normalize_endpoint_for_docker() {
  endpoint="$1"
  case "${endpoint}" in
    http://127.0.0.1:*|https://127.0.0.1:*|http://localhost:*|https://localhost:*)
      printf '%s\n' "${endpoint}" | sed 's#127\\.0\\.0\\.1#host.docker.internal#; s#localhost#host.docker.internal#'
      ;;
    *)
      printf '%s\n' "${endpoint}"
      ;;
  esac
}

run_aws_cli() {
  if command -v aws >/dev/null 2>&1; then
    AWS_ACCESS_KEY_ID="${VFS_BLOB_S3_ACCESS_KEY_ID}" \
      AWS_SECRET_ACCESS_KEY="${VFS_BLOB_S3_SECRET_ACCESS_KEY}" \
      AWS_DEFAULT_REGION="${VFS_BLOB_S3_REGION}" \
      aws --endpoint-url "${VFS_BLOB_S3_ENDPOINT}" "$@"
    return
  fi

  if ! command -v docker >/dev/null 2>&1; then
    echo "Need either aws CLI or Docker installed to manage local S3 buckets." >&2
    exit 1
  fi

  docker_endpoint="$(normalize_endpoint_for_docker "${VFS_BLOB_S3_ENDPOINT}")"
  docker run --rm \
    --add-host=host.docker.internal:host-gateway \
    -e AWS_ACCESS_KEY_ID="${VFS_BLOB_S3_ACCESS_KEY_ID}" \
    -e AWS_SECRET_ACCESS_KEY="${VFS_BLOB_S3_SECRET_ACCESS_KEY}" \
    -e AWS_DEFAULT_REGION="${VFS_BLOB_S3_REGION}" \
    amazon/aws-cli:latest \
    --endpoint-url "${docker_endpoint}" "$@"
}

wait_for_localstack() {
  retries=60
  while [ "${retries}" -gt 0 ]; do
    status_code="$(curl -s -o /dev/null -w '%{http_code}' "${VFS_BLOB_S3_ENDPOINT}/_localstack/health" || true)"
    if [ "${status_code}" = "200" ]; then
      return
    fi
    retries=$((retries - 1))
    sleep 1
  done

  echo "LocalStack did not become healthy at ${VFS_BLOB_S3_ENDPOINT}." >&2
  exit 1
}

ensure_bucket_exists() {
  if run_aws_cli s3api head-bucket --bucket "${VFS_BLOB_S3_BUCKET}" >/dev/null 2>&1; then
    return
  fi

  if [ "${VFS_BLOB_S3_REGION}" = "us-east-1" ]; then
    run_aws_cli s3api create-bucket --bucket "${VFS_BLOB_S3_BUCKET}" >/dev/null
    return
  fi

  run_aws_cli s3api create-bucket \
    --bucket "${VFS_BLOB_S3_BUCKET}" \
    --create-bucket-configuration "LocationConstraint=${VFS_BLOB_S3_REGION}" \
    >/dev/null
}

main() {
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to verify LocalStack health." >&2
    exit 1
  fi

  sync_dev_env_values

  VFS_BLOB_S3_BUCKET="$(read_env_value "${DEV_ENV_FILE}" "VFS_BLOB_S3_BUCKET" || true)"
  VFS_BLOB_S3_REGION="$(read_env_value "${DEV_ENV_FILE}" "VFS_BLOB_S3_REGION" || true)"
  VFS_BLOB_S3_ENDPOINT="$(read_env_value "${DEV_ENV_FILE}" "VFS_BLOB_S3_ENDPOINT" || true)"
  VFS_BLOB_S3_ACCESS_KEY_ID="$(read_env_value "${DEV_ENV_FILE}" "VFS_BLOB_S3_ACCESS_KEY_ID" || true)"
  VFS_BLOB_S3_SECRET_ACCESS_KEY="$(read_env_value "${DEV_ENV_FILE}" "VFS_BLOB_S3_SECRET_ACCESS_KEY" || true)"

  VFS_BLOB_S3_BUCKET="${VFS_BLOB_S3_BUCKET:-vfs-blobs}"
  VFS_BLOB_S3_REGION="${VFS_BLOB_S3_REGION:-us-east-1}"
  VFS_BLOB_S3_ENDPOINT="${VFS_BLOB_S3_ENDPOINT:-http://127.0.0.1:4566}"
  VFS_BLOB_S3_ACCESS_KEY_ID="${VFS_BLOB_S3_ACCESS_KEY_ID:-test}"
  VFS_BLOB_S3_SECRET_ACCESS_KEY="${VFS_BLOB_S3_SECRET_ACCESS_KEY:-test}"

  mkdir -p "${LOCALSTACK_DIR}/data"

  compose_cmd -f "${COMPOSE_FILE}" up -d localstack
  wait_for_localstack
  ensure_bucket_exists

  echo "Local S3 is ready at ${VFS_BLOB_S3_ENDPOINT}."
  echo "Bucket: ${VFS_BLOB_S3_BUCKET}"
}

main "$@"
