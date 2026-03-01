#!/bin/bash
# Bootstrap k8s cluster with ingress and cert-manager (staging)
#
# Loads .secrets/root.env + .secrets/staging.env so the dynamic inventory
# script can reach the Terraform S3 backend for host resolution.

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export ANSIBLE_CONFIG="${SCRIPT_DIR}/../ansible.cfg"
REPO_ROOT="$(git rev-parse --show-toplevel)"
# shellcheck source=../../terraform/scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env staging

ansible-playbook -i "$SCRIPT_DIR/../inventories/k8s-staging.sh" \
  "$SCRIPT_DIR/../playbooks/k8s.yml" "$@"
