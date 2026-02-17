#!/bin/sh
cd "$(dirname "$0")"
ansible-playbook -i ../inventories/vpn-prod.sh ../playbooks/vpn.yml
