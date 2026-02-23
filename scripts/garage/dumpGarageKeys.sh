#!/usr/bin/env sh
set -eu

ROOT_DIR="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
API_ENV_LINK_PATH="${ROOT_DIR}/packages/api/.env"
GARAGE_CREDENTIALS_FILE="${ROOT_DIR}/scripts/garage/.s3-credentials.env"

VFS_BLOB_S3_BUCKET="${VFS_BLOB_S3_BUCKET:-}"
VFS_BLOB_S3_REGION="${VFS_BLOB_S3_REGION:-}"
VFS_BLOB_S3_ENDPOINT="${VFS_BLOB_S3_ENDPOINT:-}"
VFS_BLOB_S3_ACCESS_KEY_ID="${VFS_BLOB_S3_ACCESS_KEY_ID:-}"
VFS_BLOB_S3_SECRET_ACCESS_KEY="${VFS_BLOB_S3_SECRET_ACCESS_KEY:-}"

PREFIX="${1:-}"
MAX_KEYS="${MAX_KEYS:-1000}"

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

read_env_value() {
  file_path="$1"
  key="$2"

  if [ ! -f "${file_path}" ]; then
    return 1
  fi

  awk -v key="${key}" '
    $0 ~ "^[[:space:]]*(export[[:space:]]+)?" key "=" {
      line = $0
      sub(/^[[:space:]]*(export[[:space:]]+)?/, "", line)
      sub("^" key "=", "", line)
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

load_value_if_unset() {
  key="$1"
  current_value="$(read_current_value "${key}")"
  if [ -n "${current_value}" ]; then
    return
  fi

  if [ -f "${GARAGE_CREDENTIALS_FILE}" ]; then
    value="$(read_env_value "${GARAGE_CREDENTIALS_FILE}" "${key}" || true)"
    if [ -n "${value}" ]; then
      assign_value "${key}" "${value}"
      return
    fi
  fi

  api_env_file="$(resolve_env_file_path "${API_ENV_LINK_PATH}")"
  value="$(read_env_value "${api_env_file}" "${key}" || true)"
  if [ -n "${value}" ]; then
    assign_value "${key}" "${value}"
  fi
}

read_current_value() {
  key="$1"
  case "${key}" in
    VFS_BLOB_S3_BUCKET)
      printf '%s\n' "${VFS_BLOB_S3_BUCKET}"
      ;;
    VFS_BLOB_S3_REGION)
      printf '%s\n' "${VFS_BLOB_S3_REGION}"
      ;;
    VFS_BLOB_S3_ENDPOINT)
      printf '%s\n' "${VFS_BLOB_S3_ENDPOINT}"
      ;;
    VFS_BLOB_S3_ACCESS_KEY_ID)
      printf '%s\n' "${VFS_BLOB_S3_ACCESS_KEY_ID}"
      ;;
    VFS_BLOB_S3_SECRET_ACCESS_KEY)
      printf '%s\n' "${VFS_BLOB_S3_SECRET_ACCESS_KEY}"
      ;;
    *)
      printf '\n'
      ;;
  esac
}

assign_value() {
  key="$1"
  value="$2"
  case "${key}" in
    VFS_BLOB_S3_BUCKET)
      VFS_BLOB_S3_BUCKET="${value}"
      ;;
    VFS_BLOB_S3_REGION)
      VFS_BLOB_S3_REGION="${value}"
      ;;
    VFS_BLOB_S3_ENDPOINT)
      VFS_BLOB_S3_ENDPOINT="${value}"
      ;;
    VFS_BLOB_S3_ACCESS_KEY_ID)
      VFS_BLOB_S3_ACCESS_KEY_ID="${value}"
      ;;
    VFS_BLOB_S3_SECRET_ACCESS_KEY)
      VFS_BLOB_S3_SECRET_ACCESS_KEY="${value}"
      ;;
    *)
      echo "Unsupported key: ${key}" >&2
      exit 1
      ;;
  esac
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
    echo "Need either aws CLI or Docker installed to list Garage keys." >&2
    exit 1
  fi

  docker_endpoint="$(normalize_endpoint_for_docker "${VFS_BLOB_S3_ENDPOINT}")"
  docker run --rm \
    --add-host=host.docker.internal:host-gateway \
    -e AWS_ACCESS_KEY_ID="${VFS_BLOB_S3_ACCESS_KEY_ID}" \
    -e AWS_SECRET_ACCESS_KEY="${VFS_BLOB_S3_SECRET_ACCESS_KEY}" \
    -e AWS_DEFAULT_REGION="${VFS_BLOB_S3_REGION}" \
    amazon/aws-cli:2 \
    --endpoint-url "${docker_endpoint}" "$@"
}

main() {
  load_value_if_unset VFS_BLOB_S3_BUCKET
  load_value_if_unset VFS_BLOB_S3_REGION
  load_value_if_unset VFS_BLOB_S3_ENDPOINT
  load_value_if_unset VFS_BLOB_S3_ACCESS_KEY_ID
  load_value_if_unset VFS_BLOB_S3_SECRET_ACCESS_KEY

  VFS_BLOB_S3_BUCKET="${VFS_BLOB_S3_BUCKET:-vfs-blobs}"
  VFS_BLOB_S3_REGION="${VFS_BLOB_S3_REGION:-us-east-1}"
  VFS_BLOB_S3_ENDPOINT="${VFS_BLOB_S3_ENDPOINT:-http://127.0.0.1:3900}"

  if [ -z "${VFS_BLOB_S3_ACCESS_KEY_ID}" ] || [ -z "${VFS_BLOB_S3_SECRET_ACCESS_KEY}" ]; then
    echo "Missing Garage S3 credentials. Run pnpm setupLocalGarage first." >&2
    exit 1
  fi

  echo "Listing keys from ${VFS_BLOB_S3_BUCKET} via ${VFS_BLOB_S3_ENDPOINT}" >&2

  if [ -n "${PREFIX}" ]; then
    output="$(run_aws_cli s3api list-objects-v2 \
      --bucket "${VFS_BLOB_S3_BUCKET}" \
      --prefix "${PREFIX}" \
      --max-keys "${MAX_KEYS}" \
      --query 'Contents[].Key' \
      --output text || true)"
  else
    output="$(run_aws_cli s3api list-objects-v2 \
      --bucket "${VFS_BLOB_S3_BUCKET}" \
      --max-keys "${MAX_KEYS}" \
      --query 'Contents[].Key' \
      --output text || true)"
  fi

  if [ -z "${output}" ] || [ "${output}" = "None" ]; then
    echo "(no keys found)"
    exit 0
  fi

  printf '%s\n' "${output}" | tr '\t' '\n'
}

main "$@"
