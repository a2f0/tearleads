#!/bin/bash
# Remove Tailscale devices matching a hostname prefix
# Usage: cleanup-tailscale-device.sh <hostname-prefix>
# Requires: TAILSCALE_API_TOKEN environment variable
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <hostname-prefix>" >&2
  exit 1
fi

HOSTNAME_PREFIX="$1"

if [[ -z "${TAILSCALE_API_TOKEN:-}" ]]; then
  echo "ERROR: TAILSCALE_API_TOKEN environment variable required" >&2
  exit 1
fi

echo "Removing Tailscale devices matching '$HOSTNAME_PREFIX'..."

DEVICES=$(curl -s -H "Authorization: Bearer $TAILSCALE_API_TOKEN" \
  "https://api.tailscale.com/api/v2/tailnet/-/devices" | \
  jq -r ".devices[] | select(.hostname | startswith(\"$HOSTNAME_PREFIX\")) | \"\(.id)|\(.hostname)\"")

if [[ -z "$DEVICES" ]]; then
  echo "No matching devices found."
  exit 0
fi

echo "Found devices to clean up:"
echo "$DEVICES" | tr '|' ' '

echo "$DEVICES" | while IFS='|' read -r ID NAME; do
  echo "Deleting device: $NAME ($ID)"
  curl -s -X DELETE -H "Authorization: Bearer $TAILSCALE_API_TOKEN" \
    "https://api.tailscale.com/api/v2/device/$ID"
done

echo "Cleanup complete."
