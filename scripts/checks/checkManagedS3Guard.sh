#!/usr/bin/env bash
# Exercise each managed S3 connection assertion.
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
GUARD_DIR=$(mktemp -d)
trap 'rm -rf "$GUARD_DIR"' EXIT

cat >"$GUARD_DIR/play.yml" <<EOF
---
- name: Verify managed S3 connection assertions
  hosts: all
  gather_facts: false
  tasks:
    - name: Run connection assertion
      ansible.builtin.import_tasks: $REPO_ROOT/ansible/playbooks/tasks/managedS3.yml
    - name: Mark configuration reached after the assertion
      ansible.builtin.copy:
        content: configured
        dest: $GUARD_DIR/configured
        mode: "0600"
EOF

for mutation in prod staging store bucket region endpoint path_style access_key secret_key key_prefix; do
  rm -f "$GUARD_DIR/configured"
  python3 - "$GUARD_DIR/vars.json" "$mutation" <<'PY'
import json
from pathlib import Path
import sys

values = {
    "deployment_tier": "prod",
    "blob_object_store": "s3",
    "blob_s3_bucket": "tearleads-prod",
    "blob_s3_region": "us-east-1",
    "blob_s3_endpoint": "",
    "blob_s3_force_path_style": False,
    "blob_s3_access_key_id": "fixture-s3-key",
    "blob_s3_secret_access_key": "fixture-s3-secret",
    "blob_s3_key_prefix": "",
}
changes = {
    "prod": {},
    "staging": {"deployment_tier": "staging", "blob_s3_bucket": "tearleads-staging"},
    "store": {"blob_object_store": "memory"},
    "bucket": {"blob_s3_bucket": "tearleads-staging"},
    "region": {"blob_s3_region": "eu-west-1"},
    "endpoint": {"blob_s3_endpoint": "http://127.0.0.1:3900"},
    "path_style": {"blob_s3_force_path_style": True},
    "access_key": {"blob_s3_access_key_id": ""},
    "secret_key": {"blob_s3_secret_access_key": ""},
    "key_prefix": {"blob_s3_key_prefix": "unexpected-prefix"},
}
values.update(changes[sys.argv[2]])
Path(sys.argv[1]).write_text(json.dumps(values))
PY
  result=0
  ansible-playbook -i localhost, --connection local "$GUARD_DIR/play.yml" \
    -e "@$GUARD_DIR/vars.json" -e ansible_python_interpreter=auto_silent \
    </dev/null >"$GUARD_DIR/result.log" 2>&1 || result=$?
  if [[ "$mutation" == prod || "$mutation" == staging ]]; then
    if [[ "$result" != 0 || ! -f "$GUARD_DIR/configured" ]]; then
      cat "$GUARD_DIR/result.log" >&2
      exit 1
    fi
  elif [[ "$result" == 0 || -f "$GUARD_DIR/configured" ]] ||
    ! grep -q "Provision this environment's storage stack" "$GUARD_DIR/result.log"; then
    cat "$GUARD_DIR/result.log" >&2
    echo "ERROR: Managed S3 did not reject $mutation before configuration." >&2
    exit 1
  fi
  if grep -Eq 'fixture-s3-key|fixture-s3-secret' "$GUARD_DIR/result.log"; then
    echo "ERROR: Managed S3 guard disclosed a credential." >&2
    exit 1
  fi
done
echo "Managed S3 connection guard passed."
