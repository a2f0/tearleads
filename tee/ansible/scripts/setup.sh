#!/bin/sh
set -eu

cd "$(dirname "$0")"
ansible-galaxy collection install -r ../requirements.yml
