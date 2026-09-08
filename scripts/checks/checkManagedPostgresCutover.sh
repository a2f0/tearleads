#!/usr/bin/env bash
# Prove local clusters prevent managed configuration, while empty homes pass.
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
search = 'paths: /var/lib/postgresql'
assert source.count(search) == 1
source = source.replace(probe, f'path: {root}/postgresql')
source = source.replace(search, f'paths: {root}/postgresql')
(root / 'guard.yml').write_text(source)
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

for scenario in absent_home empty_home existing_cluster; do
  if [[ "$scenario" != absent_home ]]; then
    rm "$CUTOVER_DIR/configured"
    mkdir -p "$CUTOVER_DIR/postgresql"
  fi
  if [[ "$scenario" == existing_cluster ]]; then
    # An older, non-default cluster must be caught too.
    mkdir -p "$CUTOVER_DIR/postgresql/15/legacy/base"
    echo 15 >"$CUTOVER_DIR/postgresql/15/legacy/PG_VERSION"
    echo retained >"$CUTOVER_DIR/postgresql/15/legacy/base/fixture"
  fi
  result=0
  ansible-playbook -i localhost, --connection local "$CUTOVER_DIR/play.yml" \
    -e ansible_python_interpreter=auto_silent \
    </dev/null >"$CUTOVER_DIR/result.log" 2>&1 || result=$?
  if [[ "$scenario" != existing_cluster ]]; then
    if [[ "$result" != 0 || ! -f "$CUTOVER_DIR/configured" ]]; then
      cat "$CUTOVER_DIR/result.log" >&2
      exit 1
    fi
  elif [[ "$result" == 0 || -f "$CUTOVER_DIR/configured" ]] ||
    ! grep -q 'Local PostgreSQL cluster data exists' "$CUTOVER_DIR/result.log" ||
    [[ "$(cat "$CUTOVER_DIR/postgresql/15/legacy/base/fixture")" != retained ]]; then
    cat "$CUTOVER_DIR/result.log" >&2
    echo "ERROR: Existing local data must block configuration and remain intact." >&2
    exit 1
  fi
done
echo "Managed Postgres cutover guard passed."
