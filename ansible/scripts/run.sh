#!/bin/sh
cd "$(dirname "$0")"
# Legacy entrypoint retained as an alias to the staging k8s playbook.
ansible-playbook -i ../inventories/k8s.sh ../playbooks/k8s.yml
