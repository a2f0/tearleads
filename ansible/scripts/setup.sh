#!/bin/sh
set -eu

cd "$(dirname "$0")"

mise install pipx:ansible-core
ansible-galaxy collection install -r ../requirements.yml
