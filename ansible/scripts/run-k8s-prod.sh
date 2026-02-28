#!/bin/sh
cd "$(dirname "$0")" || exit
export ANSIBLE_CONFIG="../ansible.cfg"
K3S_POD_CIDR="${1:-}"
K8S_VPC_CIDR="${2:-}"

extra_args=""
if [ -n "$K3S_POD_CIDR" ] && [ -n "$K8S_VPC_CIDR" ]; then
  extra_args="-e k3s_pod_cidr=$K3S_POD_CIDR -e k8s_vpc_cidr=$K8S_VPC_CIDR"
fi

# shellcheck disable=SC2086
ansible-playbook -i ../inventories/k8s-prod.sh ../playbooks/k8s.yml $extra_args
