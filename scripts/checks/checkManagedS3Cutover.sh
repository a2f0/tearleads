#!/usr/bin/env bash
# Exercise the real guard against retained Garage data in a temporary directory.
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
CUTOVER_DIR=$(mktemp -d)
trap 'rm -rf "$CUTOVER_DIR"' EXIT

python3 - "$REPO_ROOT/ansible/playbooks/tasks/managedS3Cutover.yml" "$CUTOVER_DIR" <<'PY'
from pathlib import Path
import sys

source = Path(sys.argv[1]).read_text()
root = Path(sys.argv[2])
probe = 'path: /var/lib/garage/data'
marker = 'path: /etc/tearleads/garage-migrated-to-'
assert source.count(probe) == 1 and source.count(marker) == 1
source = source.replace(probe, f'path: {root}/data')
source = source.replace(marker, f'path: {root}/migrated-to-')
(root / 'guard.yml').write_text(source)
PY
cat >"$CUTOVER_DIR/play.yml" <<EOF
---
- name: Verify managed S3 cutover guard
  hosts: all
  gather_facts: false
  vars:
    blob_s3_bucket: tearleads-prod
    blob_s3_region: us-east-1
  tasks:
    - name: Run cutover guard
      ansible.builtin.import_tasks: $CUTOVER_DIR/guard.yml
    - name: Mark configuration reached after the guard
      ansible.builtin.copy:
        content: configured
        dest: $CUTOVER_DIR/configured
        mode: "0600"
EOF

for scenario in fresh unmigrated wrong_bucket wrong_region marker_directory migrated; do
  rm -f "$CUTOVER_DIR/configured"
  rm -rf -- "$CUTOVER_DIR/data" "$CUTOVER_DIR"/migrated-to-*
  if [[ "$scenario" != fresh ]]; then
    mkdir -p "$CUTOVER_DIR/data"
    echo retained >"$CUTOVER_DIR/data/fixture"
  fi
  marker="$CUTOVER_DIR/migrated-to-tearleads-prod-us-east-1"
  case "$scenario" in
    wrong_bucket) touch "$CUTOVER_DIR/migrated-to-tearleads-staging-us-east-1" ;;
    wrong_region) touch "$CUTOVER_DIR/migrated-to-tearleads-prod-eu-west-1" ;;
    marker_directory) mkdir "$marker" ;;
    migrated) touch "$marker" ;;
  esac
  result=0
  ansible-playbook -i localhost, --connection local "$CUTOVER_DIR/play.yml" \
    -e ansible_python_interpreter=auto_silent \
    </dev/null >"$CUTOVER_DIR/result.log" 2>&1 || result=$?
  if [[ "$scenario" == fresh || "$scenario" == migrated ]]; then
    if [[ "$result" != 0 || ! -f "$CUTOVER_DIR/configured" ]]; then
      cat "$CUTOVER_DIR/result.log" >&2
      exit 1
    fi
  elif [[ "$result" == 0 || -f "$CUTOVER_DIR/configured" ]] ||
    ! grep -q 'Local Garage data requires an explicit migration' "$CUTOVER_DIR/result.log"; then
    cat "$CUTOVER_DIR/result.log" >&2
    echo "ERROR: Unacknowledged Garage data must block host configuration." >&2
    exit 1
  fi
  if [[ "$scenario" != fresh && "$(cat "$CUTOVER_DIR/data/fixture")" != retained ]]; then
    echo "ERROR: The Garage guard must retain existing data." >&2
    exit 1
  fi
done
echo "Managed S3 cutover guard passed."
