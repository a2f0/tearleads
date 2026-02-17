#!/bin/sh
cd "$(dirname "$0")" || exit
ansible-playbook -i ../inventories/vpn-prod.sh ../playbooks/vpn.yml
