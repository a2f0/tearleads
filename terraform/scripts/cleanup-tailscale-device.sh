#!/bin/bash
# Clean up a Tailscale device by hostname. Called by Terraform on destroy.
# Usage: cleanup-tailscale-device.sh <hostname> <tailnet>
# Requires TAILSCALE_API_TOKEN in environment.
set -euo pipefail

HOSTNAME="${1:-}"
TAILNET="${2:-}"

if [[ -z "$HOSTNAME" ]]; then
  echo "Usage: $0 <hostname> <tailnet>" >&2
  exit 0
fi

if [[ -z "${TAILSCALE_API_TOKEN:-}" ]]; then
  echo "TAILSCALE_API_TOKEN is not set, skipping Tailscale device cleanup" >&2
  exit 0
fi

if [[ -z "$TAILNET" ]]; then
  echo "Tailnet not provided, skipping Tailscale device cleanup" >&2
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl not found, skipping Tailscale device cleanup" >&2
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq not found, skipping Tailscale device cleanup" >&2
  exit 0
fi

DEVICES="$(curl -sf -H "Authorization: Bearer ${TAILSCALE_API_TOKEN}" \
  "https://api.tailscale.com/api/v2/tailnet/${TAILNET}/devices" 2>/dev/null || true)"

if [[ -z "$DEVICES" ]]; then
  echo "Could not fetch devices for tailnet '$TAILNET', skipping device cleanup" >&2
  exit 0
fi

DEVICE_ID="$(echo "$DEVICES" | jq -r --arg name "$HOSTNAME" \
  '.devices[]? | select(.hostname == $name) | .id' 2>/dev/null | head -1)"

if [[ -z "$DEVICE_ID" ]]; then
  echo "Device '$HOSTNAME' not found in tailnet, nothing to clean up"
  exit 0
fi

echo "Removing Tailscale device '$HOSTNAME' ($DEVICE_ID)..."
if curl -sf -X DELETE -H "Authorization: Bearer ${TAILSCALE_API_TOKEN}" \
  "https://api.tailscale.com/api/v2/device/${DEVICE_ID}" >/dev/null 2>&1; then
  echo "Tailscale device '$HOSTNAME' removed"
else
  echo "WARNING: Failed to remove Tailscale device '$HOSTNAME'" >&2
fi
