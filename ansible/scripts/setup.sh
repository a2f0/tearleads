#!/bin/sh
set -eu

cd "$(dirname "$0")"

# passlib is required by community.postgresql 4.x for password hashing
pip install passlib >/dev/null 2>&1 || pip3 install passlib >/dev/null 2>&1 || true

ansible-galaxy collection install -r ../requirements.yml
