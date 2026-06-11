#!/usr/bin/env bash
# Install ansible-core and required collections via mise
set -euo pipefail

cd "$(dirname "$0")"

mise install pipx:ansible-core
mise exec pipx:ansible-core -- ansible-galaxy collection install -r ../requirements.yml
