#!/bin/sh
set -eu

cd "$(dirname "$0")"

pip3 install 'ansible-core==2.16.6'
ansible-galaxy collection install -r ../requirements.yml
