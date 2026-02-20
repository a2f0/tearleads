#!/bin/sh
cd "$(dirname "$0")" || exit
ansible-playbook -i ../inventories/vault-prod.sh ../playbooks/vault.yml
