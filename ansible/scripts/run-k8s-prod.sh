#!/bin/bash
# Bootstrap k8s cluster with ingress and cert-manager (prod)
#
# Loads .secrets/root.env + .secrets/prod.env so the dynamic inventory
# script can reach the Terraform S3 backend for host resolution.

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export ANSIBLE_CONFIG="${SCRIPT_DIR}/../ansible.cfg"
REPO_ROOT="$(git rev-parse --show-toplevel)"
# shellcheck source=../../terraform/scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env prod

K3S_POD_CIDR="${1:-}"
K8S_VPC_CIDR="${2:-}"

extra_args=""
if [ -n "$K3S_POD_CIDR" ] && [ -n "$K8S_VPC_CIDR" ]; then
  extra_args="-e k3s_pod_cidr=$K3S_POD_CIDR -e k8s_vpc_cidr=$K8S_VPC_CIDR"
fi

# shellcheck disable=SC2086
ansible-playbook -i "$SCRIPT_DIR/../inventories/k8s-prod.sh" \
  "$SCRIPT_DIR/../playbooks/k8s.yml" $extra_args
