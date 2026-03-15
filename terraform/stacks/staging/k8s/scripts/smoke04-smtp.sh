#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env staging

NAMESPACE="${NAMESPACE:-tearleads}"
KUBECONFIG_FILE="${KUBECONFIG:-$HOME/.kube/config-staging-k8s}"
SMTP_HOST="${SMTP_HOST:-smtp-listener}"
SMTP_PORT="${SMTP_PORT:-25}"
SMTP_SMOKE_USER_ID="${SMTP_SMOKE_USER_ID:-}"
SMTP_SMOKE_DOMAIN="${SMTP_SMOKE_DOMAIN:-smoke.local}"
SMTP_FROM_ADDRESS="${SMTP_FROM_ADDRESS:-noreply@$SMTP_SMOKE_DOMAIN}"
SMTP_WAIT_RETRIES="${SMTP_WAIT_RETRIES:-10}"
SMTP_WAIT_DELAY="${SMTP_WAIT_DELAY:-2}"

require_kubeconfig_and_kubectl() {
  if [[ ! -f "$KUBECONFIG_FILE" ]]; then
    echo "ERROR: Kubeconfig not found at $KUBECONFIG_FILE"
    echo "Run $SCRIPT_DIR/kubeconfig.sh first, then retry."
    exit 1
  fi

  export KUBECONFIG="$KUBECONFIG_FILE"

  if ! command -v kubectl >/dev/null 2>&1; then
    echo "ERROR: kubectl is required."
    exit 1
  fi
}

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; return 1; }

get_running_pod_or_fail() {
  local label="$1"
  local pod
  pod="$(kubectl -n "$NAMESPACE" get pods -l "$label" --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [[ -z "$pod" ]]; then
    echo "ERROR: no running pod found for label $label in namespace $NAMESPACE"
    exit 1
  fi
  printf '%s\n' "$pod"
}

postgres_query_or_fail() {
  local postgres_pod="$1"
  local sql="$2"
  local output
  if ! output="$(kubectl -n "$NAMESPACE" exec "$postgres_pod" -c postgres -- sh -lc "PGPASSWORD=\"\$POSTGRES_PASSWORD\" psql -h 127.0.0.1 -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -tAc \"$sql\"" 2>/dev/null)"; then
    echo "ERROR: failed postgres query: $sql"
    exit 1
  fi
  printf '%s\n' "$output" | tr -d '\r'
}

resolve_vfs_recipient_user_id_or_fail() {
  local postgres_pod="$1"
  if [[ -n "$SMTP_SMOKE_USER_ID" ]]; then
    printf '%s\n' "$SMTP_SMOKE_USER_ID"
    return
  fi
  local user_id
  user_id="$(postgres_query_or_fail "$postgres_pod" "SELECT id FROM users ORDER BY created_at ASC LIMIT 1")"
  if [[ -z "$user_id" ]]; then
    echo "ERROR: no users found for VFS SMTP smoke test."
    echo "Create a user first or set SMTP_SMOKE_USER_ID explicitly."
    exit 1
  fi
  printf '%s\n' "$user_id"
}

# Phase 1: Cross-pod TCP reachability from the postgres pod to the SMTP
# listener service. Uses bash /dev/tcp to avoid requiring Node.js or netcat,
# removing the former dependency on the Node.js API pod (#2555).
phase_tcp_reachability() {
  echo ""
  echo "Phase 1: Cross-pod TCP reachability to SMTP listener"

  local postgres_pod
  postgres_pod="$(get_running_pod_or_fail "app=postgres")"

  if kubectl -n "$NAMESPACE" exec "$postgres_pod" -c postgres -- \
    bash -c "exec 3<>/dev/tcp/$SMTP_HOST/$SMTP_PORT && exec 3<&- && exec 3>&-" 2>/dev/null; then
    pass "postgres pod $postgres_pod reached $SMTP_HOST:$SMTP_PORT"
    return 0
  fi

  fail "postgres pod $postgres_pod could not reach $SMTP_HOST:$SMTP_PORT"
}

# Phase 2: Full SMTP conversation followed by Postgres verification.
# Runs the SMTP client inside the smtp-listener pod (which has Node.js)
# connecting to 127.0.0.1:25. This removes the dependency on the Node.js
# API pod (#2555) while still exercising the SMTP protocol handler and
# the VFS ingest/storage pipeline end-to-end.
phase_send_and_verify_storage() {
  echo ""
  echo "Phase 2: Send SMTP message and verify VFS storage"

  local smtp_pod postgres_pod
  smtp_pod="$(get_running_pod_or_fail "app=smtp-listener")"
  postgres_pod="$(get_running_pod_or_fail "app=postgres")"

  local recipient_local_part
  recipient_local_part="$(resolve_vfs_recipient_user_id_or_fail "$postgres_pod")"

  local smtp_to marker before_count after_count attempt
  smtp_to="${recipient_local_part}@${SMTP_SMOKE_DOMAIN}"
  marker="smtp-smoke-$(date +%s)-$RANDOM"

  before_count="$(postgres_query_or_fail "$postgres_pod" "SELECT COUNT(*) FROM emails e JOIN vfs_registry r ON r.id = e.id WHERE r.owner_id = '$recipient_local_part'")"
  if [[ ! "$before_count" =~ ^[0-9]+$ ]]; then
    before_count=0
  fi

  local smtp_output
  if ! smtp_output="$(kubectl -n "$NAMESPACE" exec "$smtp_pod" -c smtp-listener -- env \
    SMTP_TO="$smtp_to" \
    SMTP_FROM="$SMTP_FROM_ADDRESS" \
    SMTP_MARKER="$marker" \
    node -e "
      const net = require('net');
      const to = process.env.SMTP_TO;
      const from = process.env.SMTP_FROM;
      const marker = process.env.SMTP_MARKER;

      if (!to || !from || !marker) {
        console.error('missing SMTP_TO/SMTP_FROM/SMTP_MARKER');
        process.exit(1);
      }

      const steps = [
        { expect: 220, send: \`EHLO smoke.local\\r\\n\` },
        { expect: 250, send: \`MAIL FROM:<\${from}>\\r\\n\` },
        { expect: 250, send: \`RCPT TO:<\${to}>\\r\\n\` },
        { expect: 250, send: \`DATA\\r\\n\` },
        {
          expect: 354,
          send: [
            \`Subject: SMTP smoke \${marker}\`,
            \`From: <\${from}>\`,
            \`To: <\${to}>\`,
            '',
            \`SMTP smoke marker: \${marker}\`,
            '.',
            ''
          ].join('\\r\\n')
        },
        { expect: 250, send: \`QUIT\\r\\n\`, done: true }
      ];

      let idx = 0;
      let buffer = '';
      let timeout = null;

      const socket = net.createConnection({ host: '127.0.0.1', port: 25 });

      const fail = (msg) => {
        if (timeout) clearTimeout(timeout);
        try { socket.destroy(); } catch (_) {}
        console.error(msg);
        process.exit(1);
      };

      const armTimeout = () => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => fail('SMTP conversation timed out'), 10000);
      };

      const maybeAdvance = (line) => {
        const step = steps[idx];
        if (!step) {
          return;
        }
        const code = Number(line.slice(0, 3));
        if (!Number.isFinite(code) || code !== step.expect) {
          fail(\`unexpected SMTP response: \${line} (expected \${step.expect})\`);
          return;
        }
        if (line[3] === '-') {
          return;
        }
        socket.write(step.send);
        idx += 1;
        if (step.done) {
          if (timeout) clearTimeout(timeout);
          socket.end();
          process.exit(0);
        }
      };

      socket.on('connect', armTimeout);
      socket.on('data', (chunk) => {
        armTimeout();
        buffer += chunk.toString('utf8');
        const lines = buffer.split(/\\r?\\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.length < 3) continue;
          maybeAdvance(line);
        }
      });
      socket.on('error', (err) => fail(err.message));
      socket.on('end', () => {
        if (idx < steps.length) {
          fail('SMTP connection closed before conversation completed');
        }
      });
    " 2>&1)"; then
    fail "failed to submit SMTP message via smtp-listener pod $smtp_pod. Output: ${smtp_output:-none}"
    return 1
  fi

  after_count="$before_count"
  attempt=1
  while (( attempt <= SMTP_WAIT_RETRIES )); do
    after_count="$(postgres_query_or_fail "$postgres_pod" "SELECT COUNT(*) FROM emails e JOIN vfs_registry r ON r.id = e.id WHERE r.owner_id = '$recipient_local_part'")"
    if [[ "$after_count" =~ ^[0-9]+$ ]] && (( after_count > before_count )); then
      break
    fi
    sleep "$SMTP_WAIT_DELAY"
    attempt=$((attempt + 1))
  done

  if [[ ! "$after_count" =~ ^[0-9]+$ ]] || (( after_count <= before_count )); then
    fail "SMTP message not observed in VFS backend after send (before=$before_count, after=$after_count, smtp_pod=$smtp_pod)"
    return 1
  fi

  pass "SMTP message accepted and observed in Postgres emails/vfs_registry for user $recipient_local_part (before=$before_count, after=$after_count)"
}

require_kubeconfig_and_kubectl

echo "SMTP smoke test for staging K8s deployment"
echo "  Namespace:   $NAMESPACE"
echo "  Kubeconfig:  $KUBECONFIG"
echo "  SMTP target: $SMTP_HOST:$SMTP_PORT"

failures=0

phase_tcp_reachability         || failures=$((failures + 1))
phase_send_and_verify_storage  || failures=$((failures + 1))

echo ""
if (( failures == 0 )); then
  echo "All SMTP smoke checks passed."
else
  echo "ERROR: $failures phase(s) failed."
  exit 1
fi
