#!/bin/sh
cd "$(dirname "$0")"
ansible-playbook -i ../inventories/example.sh ../playbooks/example.yml
