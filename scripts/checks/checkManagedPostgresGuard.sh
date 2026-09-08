#!/usr/bin/env bash
# Exercise the actual Ansible guard before it can configure production.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
GUARD_DIR=$(mktemp -d)
trap 'rm -rf "$GUARD_DIR"' EXIT
cat >"$GUARD_DIR/play.yml" <<EOF
---
- name: Validate managed Postgres fixture
  hosts: all
  gather_facts: false
  tasks:
    - name: Run production connection guard
      ansible.builtin.import_tasks: $REPO_ROOT/ansible/playbooks/tasks/managedPostgres.yml
EOF

for mutation in valid host tls password migration_user missing_migration_user; do
  python3 - "$1" "$GUARD_DIR/vars.json" "$mutation" <<'PY'
import json
import sys

with open(sys.argv[1]) as source:
    values = json.load(source)
changes = {
    "valid": {},
    "host": {"postgres_host": "127.0.0.1"},
    "tls": {"postgres_ssl": False},
    "password": {"postgres_password": ""},
    "migration_user": {"postgres_migration_user": values["postgres_user"]},
    "missing_migration_user": {},
}
values.update(changes[sys.argv[3]])
if sys.argv[3] == "missing_migration_user":
    del values["postgres_migration_user"]
with open(sys.argv[2], "w") as output:
    json.dump(values, output)
PY
  result=0
  ansible-playbook -i localhost, --connection local "$GUARD_DIR/play.yml" \
    -e "@$GUARD_DIR/vars.json" </dev/null >"$GUARD_DIR/result" 2>&1 || result=$?
  if [[ "$mutation" == valid ]]; then
    if [[ "$result" != 0 ]]; then
      cat "$GUARD_DIR/result" >&2
      exit 1
    fi
  elif [[ "$result" == 0 ]] || ! grep -q 'Apply the persistent Postgres stack' "$GUARD_DIR/result"; then
    cat "$GUARD_DIR/result" >&2
    echo "ERROR: Managed Postgres guard did not diagnose $mutation." >&2
    exit 1
  fi
  if grep -q 'fixture.*password' "$GUARD_DIR/result"; then
    echo "ERROR: Managed Postgres guard disclosed a credential." >&2
    exit 1
  fi
done
