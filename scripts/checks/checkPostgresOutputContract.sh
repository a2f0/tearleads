#!/usr/bin/env bash
# Feed the actual mocked Terraform output through the production Ansible seam.
set -euo pipefail

if [[ $# != 1 ]]; then
  echo "Usage: $(basename "$0") <terraform-test.jsonl>" >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
CONTRACT_DIR=$(mktemp -d)
trap 'rm -rf "$CONTRACT_DIR"' EXIT

jq -se '
  [.[] | select(.type == "test_plan" and .["@testrun"] == "api_connection_uses_persistent_branch")]
  | if length == 1 then .[0].test_plan.output_changes.api_connection.after else null end
  | select(type == "object")
' "$1" >"$CONTRACT_DIR/connection.json"

cat >"$CONTRACT_DIR/play.yml" <<EOF
---
- name: Verify Terraform to Ansible database contract
  hosts: all
  gather_facts: false
  vars:
    redis_bind: 127.0.0.1
    api_cors_origins: https://app.example.test
    document_sync_cursor_hmac_key: fixture-cursor-key
  tasks:
    - name: Require managed mode from Terraform
      ansible.builtin.assert:
        that: postgres_managed | bool
    - name: Validate the unmodified Terraform connection output
      ansible.builtin.import_tasks: $REPO_ROOT/ansible/playbooks/tasks/managedPostgres.yml
    - name: Render both database environments from Terraform output
      ansible.builtin.template:
        src: "$REPO_ROOT/ansible/playbooks/templates/etc/tearleads/{{ item }}.env.j2"
        dest: "$CONTRACT_DIR/{{ item }}.env"
        mode: "0600"
      loop:
        - api
        - migrations
EOF

if ! ansible-playbook -i localhost, --connection local "$CONTRACT_DIR/play.yml" \
  -e ansible_python_interpreter=auto_silent -e "@$CONTRACT_DIR/connection.json" \
  </dev/null >"$CONTRACT_DIR/result.log" 2>&1; then
  cat "$CONTRACT_DIR/result.log" >&2
  exit 1
fi
echo "Terraform-to-Ansible Postgres connection contract passed."
