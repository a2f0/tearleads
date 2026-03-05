#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/dump-s3-bucket.sh" \
  --bucket "${S3_BUCKET:-vfs-blobs}" \
  --key-id-env VFS_BLOB_S3_ACCESS_KEY_ID \
  --secret-env VFS_BLOB_S3_SECRET_ACCESS_KEY
