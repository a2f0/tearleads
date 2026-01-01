#!/bin/sh
cd "$(dirname "$0")"
ansible-playbook -i ../inventories/main.sh ../playbooks/auto-patch.yml
