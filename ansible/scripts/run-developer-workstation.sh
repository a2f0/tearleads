#!/bin/bash
# Configure local developer workstation SSH for staging and production servers
#
# Loads .secrets/env automatically via terraform/scripts/common.sh.
# Required values (from shell or .secrets/env):
#   TF_VAR_staging_domain
#   TF_VAR_production_domain

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export ANSIBLE_CONFIG="${SCRIPT_DIR}/../ansible.cfg"
REPO_ROOT="$(git rev-parse --show-toplevel)"
# shellcheck source=../../terraform/scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env
validate_staging_domain_env
validate_production_domain_env

ansible-playbook -i localhost, "$SCRIPT_DIR/../playbooks/developerWorkstation.yml" "$@"
