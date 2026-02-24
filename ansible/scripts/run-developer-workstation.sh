#!/bin/bash
# Configure local developer workstation SSH for staging and production servers
#
# Loads .secrets/root.env, then each tier env to resolve TF_VAR_domain
# for staging and production respectively.

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export ANSIBLE_CONFIG="${SCRIPT_DIR}/../ansible.cfg"
REPO_ROOT="$(git rev-parse --show-toplevel)"
# shellcheck source=../../terraform/scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

# Load staging env to capture its domain
load_secrets_env staging
STAGING_DOMAIN="${TF_VAR_domain:-}"

# Load prod env to capture its domain (overwrites TF_VAR_domain)
load_secrets_env prod
PRODUCTION_DOMAIN="${TF_VAR_domain:-}"

if [[ -z "$STAGING_DOMAIN" || -z "$PRODUCTION_DOMAIN" ]]; then
  echo "ERROR: TF_VAR_domain must be set in both .secrets/staging.env and .secrets/prod.env" >&2
  exit 1
fi

ansible-playbook -i localhost, \
  -e "staging_domain=$STAGING_DOMAIN" \
  -e "production_domain=$PRODUCTION_DOMAIN" \
  "$SCRIPT_DIR/../playbooks/developerWorkstation.yml" "$@"
