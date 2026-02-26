#!/bin/sh
cd "$(dirname "$0")" || exit
export ANSIBLE_CONFIG="../ansible.cfg"
ansible-playbook -i ../inventories/k8s-staging.sh ../playbooks/k8s.yml "$@"
