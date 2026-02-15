#!/bin/sh
cd "$(dirname "$0")"
ansible-playbook -i ../inventories/k8s-prod.sh ../playbooks/k8s.yml
