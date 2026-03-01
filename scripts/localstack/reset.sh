#!/usr/bin/env sh
set -eu

ROOT_DIR="$(cd -- "$(dirname -- "$0")/../.." && pwd -P)"
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
    echo "Need either aws CLI or Docker installed to manage local S3 objects." >&2
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

main() {
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

  if ! run_aws_cli s3api head-bucket --bucket "${VFS_BLOB_S3_BUCKET}" >/dev/null 2>&1; then
    echo "Bucket ${VFS_BLOB_S3_BUCKET} does not exist at ${VFS_BLOB_S3_ENDPOINT}; nothing to reset."
    exit 0
  fi

  echo "Deleting all objects from ${VFS_BLOB_S3_BUCKET} via ${VFS_BLOB_S3_ENDPOINT}..."
  run_aws_cli s3 rm "s3://${VFS_BLOB_S3_BUCKET}/" --recursive >/dev/null
  echo "Local S3 reset complete."
}

main "$@"
