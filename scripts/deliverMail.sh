#!/bin/sh
# Usage:
#   ./scripts/deliverMail.sh
#   SMTP_HOST=localhost SMTP_PORT=25 SMTP_TO=test@localhost ./scripts/deliverMail.sh
#   SMTP_TO_USER_ID=<uuid> SMTP_TO_DOMAIN=smoke.local ./scripts/deliverMail.sh
set -eu

HOST=${SMTP_HOST:-localhost}
PORT=${SMTP_PORT:-25}
TO_USER_ID=${SMTP_TO_USER_ID:-}
TO_DOMAIN=${SMTP_TO_DOMAIN:-localhost}
if [ -n "$TO_USER_ID" ]; then
  TO_ADDRESS="${TO_USER_ID}@${TO_DOMAIN}"
else
  TO_ADDRESS=${SMTP_TO:-test@localhost}
fi
FROM_ADDRESS=${SMTP_FROM:-test@example.com}
MARKER=${SMTP_MARKER:-}
if [ -n "$MARKER" ]; then
  SUBJECT_DEFAULT="Test email from deliverMail.sh [$MARKER]"
else
  SUBJECT_DEFAULT="Test email from deliverMail.sh"
fi
SUBJECT=${SMTP_SUBJECT:-$SUBJECT_DEFAULT}
TIMESTAMP=$(date -R)
if [ -n "$MARKER" ]; then
  BODY_DEFAULT="SMTP marker: ${MARKER}
This is a test message sent at ${TIMESTAMP}"
else
  BODY_DEFAULT="This is a test message sent at ${TIMESTAMP}"
fi
BODY=${SMTP_BODY:-$BODY_DEFAULT}

echo "Sending test email to ${TO_ADDRESS} via ${HOST}:${PORT}..."

curl --silent --show-error --url "smtp://${HOST}:${PORT}" \
  --mail-from "${FROM_ADDRESS}" \
  --mail-rcpt "${TO_ADDRESS}" \
  --upload-file - <<EOF
From: ${FROM_ADDRESS}
To: ${TO_ADDRESS}
Subject: ${SUBJECT}
Date: ${TIMESTAMP}

${BODY}
EOF

echo "Email sent successfully"
