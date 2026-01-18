#!/bin/sh
# Usage:
#   ./scripts/deliverMail.sh
#   SMTP_HOST=localhost SMTP_PORT=25 SMTP_TO=test@localhost ./scripts/deliverMail.sh
set -eu

HOST=${SMTP_HOST:-localhost}
PORT=${SMTP_PORT:-25}
TO_ADDRESS=${SMTP_TO:-test@localhost}
FROM_ADDRESS=${SMTP_FROM:-test@example.com}
SUBJECT=${SMTP_SUBJECT:-Test email from deliverMail.sh}
TIMESTAMP=$(date -R)

echo "Sending test email to ${TO_ADDRESS} via ${HOST}:${PORT}..."

curl --silent --show-error --url "smtp://${HOST}:${PORT}" \
  --mail-from "${FROM_ADDRESS}" \
  --mail-rcpt "${TO_ADDRESS}" \
  --upload-file - <<EOF
From: ${FROM_ADDRESS}
To: ${TO_ADDRESS}
Subject: ${SUBJECT}
Date: ${TIMESTAMP}

This is a test message sent at ${TIMESTAMP}
EOF

echo "Email sent successfully"
