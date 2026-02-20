#!/bin/sh
# Configure local developer workstation SSH for staging and production servers
#
# Required environment variables:
#   TF_VAR_staging_domain    - Staging domain (e.g., staging.example.com)
#   TF_VAR_production_domain - Production domain (e.g., example.com)
#
# Optional environment variables:
#   TF_VAR_server_username   - Deploy user (default: deploy)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Validate required environment variables
if [ -z "$TF_VAR_staging_domain" ]; then
  echo "ERROR: TF_VAR_staging_domain not set" >&2
  exit 1
fi

if [ -z "$TF_VAR_production_domain" ]; then
  echo "ERROR: TF_VAR_production_domain not set" >&2
  exit 1
fi

ansible-playbook -i localhost, "$SCRIPT_DIR/../playbooks/developerWorkstation.yml" "$@"
