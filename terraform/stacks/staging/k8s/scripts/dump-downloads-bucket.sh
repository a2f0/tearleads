#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/dump-s3-bucket.sh" \
  --bucket "${S3_BUCKET:-desktop-downloads}" \
  --key-id-env DESKTOP_DOWNLOADS_S3_ACCESS_KEY_ID \
  --secret-env DESKTOP_DOWNLOADS_S3_SECRET_ACCESS_KEY
