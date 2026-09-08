#!/usr/bin/env bash
# Prove a local data directory prevents managed configuration on an old host.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
CUTOVER_DIR=$(mktemp -d)
trap 'rm -rf "$CUTOVER_DIR"' EXIT

# Only redirect the filesystem probe; execute the production guard unchanged.
python3 - "$REPO_ROOT/ansible/playbooks/tasks/managedPostgresCutover.yml" "$CUTOVER_DIR" <<'PY'
from pathlib import Path
import sys

source = Path(sys.argv[1]).read_text()
root = Path(sys.argv[2])
probe = 'path: /var/lib/postgresql'
assert source.count(probe) == 1
(root / 'guard.yml').write_text(source.replace(probe, f'path: {root}/postgresql'))
PY

cat >"$CUTOVER_DIR/play.yml" <<EOF
---
- name: Verify managed database cutover guard
  hosts: all
  gather_facts: false
  tasks:
    - name: Run cutover guard
      ansible.builtin.import_tasks: $CUTOVER_DIR/guard.yml
    - name: Mark configuration reached after the guard
      ansible.builtin.copy:
        content: configured
        dest: $CUTOVER_DIR/configured
        mode: "0600"
EOF

for existing_data in false true; do
  if [[ "$existing_data" == true ]]; then
    rm "$CUTOVER_DIR/configured"
    mkdir -p "$CUTOVER_DIR/postgresql/16/main/base"
    echo retained >"$CUTOVER_DIR/postgresql/16/main/base/fixture"
  fi
  result=0
  ansible-playbook -i localhost, --connection local "$CUTOVER_DIR/play.yml" \
    -e ansible_python_interpreter=auto_silent \
    </dev/null >"$CUTOVER_DIR/result.log" 2>&1 || result=$?
  if [[ "$existing_data" == false ]]; then
    if [[ "$result" != 0 || ! -f "$CUTOVER_DIR/configured" ]]; then
      cat "$CUTOVER_DIR/result.log" >&2
      exit 1
    fi
  elif [[ "$result" == 0 || -f "$CUTOVER_DIR/configured" ]] ||
    ! grep -q 'Local PostgreSQL data exists' "$CUTOVER_DIR/result.log" ||
    [[ "$(cat "$CUTOVER_DIR/postgresql/16/main/base/fixture")" != retained ]]; then
    cat "$CUTOVER_DIR/result.log" >&2
    echo "ERROR: Existing local data must block configuration and remain intact." >&2
    exit 1
  fi
done
echo "Managed Postgres cutover guard passed."
