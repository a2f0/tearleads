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
SMTP_SMOKE_USER="${SMTP_SMOKE_USER:-smtp-smoke}"
SMTP_SMOKE_USER_ID="${SMTP_SMOKE_USER_ID:-}"
SMTP_SMOKE_DOMAIN="${SMTP_SMOKE_DOMAIN:-smoke.local}"
SMTP_FROM_ADDRESS="${SMTP_FROM_ADDRESS:-noreply@$SMTP_SMOKE_DOMAIN}"
SMTP_SMOKE_BACKEND="${SMTP_SMOKE_BACKEND:-auto}"
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

resolve_storage_backend() {
  local api_pod="$1"
  local backend="$SMTP_SMOKE_BACKEND"
  if [[ "$backend" != "auto" ]]; then
    printf '%s\n' "$backend"
    return
  fi

  local detected
  detected="$(kubectl -n "$NAMESPACE" exec "$api_pod" -c api -- sh -lc 'printf "%s" "${EMAIL_STORAGE_BACKEND:-}"' 2>/dev/null || true)"
  detected="$(printf '%s' "$detected" | tr -d '\r' | tr '[:upper:]' '[:lower:]')"
  if [[ "$detected" == "vfs" ]]; then
    printf 'vfs\n'
    return
  fi
  printf 'redis\n'
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
    echo "ERROR: no users found for VFS SMTP smoke test; set SMTP_SMOKE_USER_ID explicitly."
    exit 1
  fi
  printf '%s\n' "$user_id"
}

phase_api_to_smtp_tcp() {
  echo ""
  echo "Phase 1: API pod TCP reachability to SMTP listener"

  local api_pod
  api_pod="$(get_running_pod_or_fail "app=api")"

  local node_output
  if node_output="$(kubectl -n "$NAMESPACE" exec "$api_pod" -c api -- node -e "
    const net = require('net');
    const host = process.env.SMTP_HOST || 'smtp-listener';
    const port = Number(process.env.SMTP_PORT || '25');
    const socket = net.createConnection({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      console.error(\`timeout connecting to \${host}:\${port}\`);
      process.exit(1);
    }, 5000);
    socket.on('connect', () => {
      clearTimeout(timeout);
      socket.end();
      process.exit(0);
    });
    socket.on('error', (err) => {
      clearTimeout(timeout);
      console.error(err.message);
      process.exit(1);
    });
  " 2>&1)"; then
    pass "API pod $api_pod reached $SMTP_HOST:$SMTP_PORT"
    return 0
  fi

  fail "API pod $api_pod could not reach $SMTP_HOST:$SMTP_PORT. Output: ${node_output:-No output}"
}

phase_send_and_verify_storage() {
  echo ""
  echo "Phase 2: Send SMTP message and verify storage backend"

  local api_pod redis_pod postgres_pod smtp_pod
  api_pod="$(get_running_pod_or_fail "app=api")"
  smtp_pod="$(get_running_pod_or_fail "app=smtp-listener")"
  local backend
  backend="$(resolve_storage_backend "$api_pod")"

  if [[ "$backend" != "redis" && "$backend" != "vfs" ]]; then
    fail "unsupported SMTP smoke backend '$backend' (expected redis or vfs)"
    return 1
  fi
  echo "  Backend: $backend"

  if [[ "$backend" == "redis" ]]; then
    redis_pod="$(get_running_pod_or_fail "app=redis")"
  else
    postgres_pod="$(get_running_pod_or_fail "app=postgres")"
  fi

  local recipient_local_part
  if [[ "$backend" == "vfs" ]]; then
    recipient_local_part="$(resolve_vfs_recipient_user_id_or_fail "$postgres_pod")"
  else
    recipient_local_part="$SMTP_SMOKE_USER"
  fi

  local smtp_to redis_list_key marker before_count after_count email_id stored_json attempt
  smtp_to="${recipient_local_part}@${SMTP_SMOKE_DOMAIN}"
  redis_list_key="smtp:emails:${recipient_local_part}"
  marker="smtp-smoke-$(date +%s)-$RANDOM"

  if [[ "$backend" == "redis" ]]; then
    before_count="$(kubectl -n "$NAMESPACE" exec "$redis_pod" -c redis -- redis-cli LLEN "$redis_list_key" 2>/dev/null || echo 0)"
  else
    before_count="$(postgres_query_or_fail "$postgres_pod" "SELECT COUNT(*) FROM email_recipients WHERE user_id = '$recipient_local_part'")"
  fi
  if [[ ! "$before_count" =~ ^[0-9]+$ ]]; then
    before_count=0
  fi

  if ! kubectl -n "$NAMESPACE" exec "$api_pod" -c api -- env \
    SMTP_HOST="$SMTP_HOST" \
    SMTP_PORT="$SMTP_PORT" \
    SMTP_TO="$smtp_to" \
    SMTP_FROM="$SMTP_FROM_ADDRESS" \
    SMTP_MARKER="$marker" \
    node -e "
      const net = require('net');
      const host = process.env.SMTP_HOST || 'smtp-listener';
      const port = Number(process.env.SMTP_PORT || '25');
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

      const socket = net.createConnection({ host, port });

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
    " >/dev/null 2>&1; then
    fail "failed to submit SMTP message from API pod $api_pod to $SMTP_HOST:$SMTP_PORT"
    return 1
  fi

  after_count="$before_count"
  attempt=1
  while (( attempt <= SMTP_WAIT_RETRIES )); do
    if [[ "$backend" == "redis" ]]; then
      after_count="$(kubectl -n "$NAMESPACE" exec "$redis_pod" -c redis -- redis-cli LLEN "$redis_list_key" 2>/dev/null || echo 0)"
    else
      after_count="$(postgres_query_or_fail "$postgres_pod" "SELECT COUNT(*) FROM email_recipients WHERE user_id = '$recipient_local_part'")"
    fi
    if [[ "$after_count" =~ ^[0-9]+$ ]] && (( after_count > before_count )); then
      break
    fi
    sleep "$SMTP_WAIT_DELAY"
    attempt=$((attempt + 1))
  done

  if [[ ! "$after_count" =~ ^[0-9]+$ ]] || (( after_count <= before_count )); then
    fail "SMTP message not observed in $backend backend after send (before=$before_count, after=$after_count, smtp_pod=$smtp_pod)"
    return 1
  fi

  if [[ "$backend" == "vfs" ]]; then
    pass "SMTP message accepted and observed in Postgres email_recipients for user $recipient_local_part (before=$before_count, after=$after_count)"
    return 0
  fi

  email_id="$(kubectl -n "$NAMESPACE" exec "$redis_pod" -c redis -- redis-cli LINDEX "$redis_list_key" 0 2>/dev/null || true)"
  email_id="$(printf '%s' "$email_id" | tr -d '\r')"
  if [[ -z "$email_id" ]]; then
    fail "SMTP list $redis_list_key updated but could not read latest email id"
    return 1
  fi

  stored_json="$(kubectl -n "$NAMESPACE" exec "$redis_pod" -c redis -- redis-cli GET "smtp:email:$email_id" 2>/dev/null || true)"
  if ! printf '%s' "$stored_json" | grep -Fq "$marker"; then
    fail "stored email smtp:email:$email_id does not contain expected marker $marker"
    return 1
  fi

  kubectl -n "$NAMESPACE" exec "$redis_pod" -c redis -- redis-cli LREM "$redis_list_key" 1 "$email_id" >/dev/null 2>&1 || true
  kubectl -n "$NAMESPACE" exec "$redis_pod" -c redis -- redis-cli DEL "smtp:email:$email_id" "smtp:email:users:$email_id" >/dev/null 2>&1 || true

  pass "SMTP message accepted by $SMTP_HOST:$SMTP_PORT, persisted in Redis, and cleaned up (email id: $email_id)"
}

require_kubeconfig_and_kubectl

echo "SMTP smoke test for staging K8s deployment"
echo "  Namespace:   $NAMESPACE"
echo "  Kubeconfig:  $KUBECONFIG"
echo "  SMTP target: $SMTP_HOST:$SMTP_PORT"

failures=0

phase_api_to_smtp_tcp       || failures=$((failures + 1))
phase_send_and_verify_storage || failures=$((failures + 1))

echo ""
if (( failures == 0 )); then
  echo "All SMTP smoke checks passed."
else
  echo "ERROR: $failures phase(s) failed."
  exit 1
fi
