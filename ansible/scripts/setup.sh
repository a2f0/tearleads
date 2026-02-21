#!/bin/sh
set -eu

cd "$(dirname "$0")"

pip install ansible
ansible-galaxy collection install -r ../requirements.yml
