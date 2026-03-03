#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env prod

NAMESPACE="${NAMESPACE:-tearleads}"
CONFIGMAP_NAME="${CONFIGMAP_NAME:-tearleads-config}"
CRONJOB_NAME="${CRONJOB_NAME:-vfs-crdt-compaction}"
KUBECONFIG_FILE="${KUBECONFIG:-$HOME/.kube/config-prod-k8s}"

usage() {
  cat <<'EOF'
Usage: vfs-crdt-compaction.sh <command> [args]

Commands:
  status                         Show CronJob status and effective compaction config
  show-config                    Show compaction config values from ConfigMap
  enable                         Set VFS_CRDT_COMPACTION_EXECUTE=1
  disable                        Set VFS_CRDT_COMPACTION_EXECUTE=0
  suspend                        Suspend the CronJob schedule
  resume                         Resume the CronJob schedule
  run-once [job-name]            Trigger one immediate run from the CronJob template
  logs [kubectl-log-args...]     Show logs for latest compaction run (supports -f, --since, --tail)
  set-max-delete-rows <rows>     Set VFS_CRDT_COMPACTION_MAX_DELETE_ROWS
  set-schedule "<cron>"          Set CronJob schedule (for example "*/30 * * * *")
  help                           Show this help
EOF
}

ensure_kubectl_context() {
  if [[ ! -f "$KUBECONFIG_FILE" ]]; then
    echo "ERROR: Kubeconfig not found at $KUBECONFIG_FILE" >&2
    echo "Run $SCRIPT_DIR/kubeconfig.sh first, then retry." >&2
    exit 1
  fi

  if ! command -v kubectl >/dev/null 2>&1; then
    echo "ERROR: kubectl is required." >&2
    exit 1
  fi

  export KUBECONFIG="$KUBECONFIG_FILE"
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

patch_config_value() {
  local key="$1"
  local value="$2"
  local escaped_value
  escaped_value="$(json_escape "$value")"

  kubectl -n "$NAMESPACE" patch configmap "$CONFIGMAP_NAME" \
    --type merge \
    -p "{\"data\":{\"$key\":\"$escaped_value\"}}" >/dev/null
}

show_config() {
  local keys=(
    "VFS_CRDT_COMPACTION_EXECUTE"
    "VFS_CRDT_COMPACTION_HOT_RETENTION_DAYS"
    "VFS_CRDT_COMPACTION_INACTIVE_CLIENT_DAYS"
    "VFS_CRDT_COMPACTION_SAFETY_BUFFER_HOURS"
    "VFS_CRDT_COMPACTION_MAX_DELETE_ROWS"
    "VFS_CRDT_COMPACTION_SKIP_SNAPSHOT_REFRESH"
  )

  echo "ConfigMap: $CONFIGMAP_NAME"
  local key value
  for key in "${keys[@]}"; do
    value="$(kubectl -n "$NAMESPACE" get configmap "$CONFIGMAP_NAME" -o "jsonpath={.data.$key}")"
    if [[ -z "$value" ]]; then
      value="<unset>"
    fi
    echo "  $key=$value"
  done
}

status() {
  echo "CronJob: $CRONJOB_NAME (namespace: $NAMESPACE)"
  kubectl -n "$NAMESPACE" get cronjob "$CRONJOB_NAME" \
    -o custom-columns=NAME:.metadata.name,SCHEDULE:.spec.schedule,SUSPEND:.spec.suspend,LAST_SCHEDULE:.status.lastScheduleTime,ACTIVE:.status.active[*].name
  echo ""
  show_config
}

set_execute() {
  local value="$1"
  patch_config_value "VFS_CRDT_COMPACTION_EXECUTE" "$value"
  echo "Set VFS_CRDT_COMPACTION_EXECUTE=$value"
}

set_suspend() {
  local value="$1"
  kubectl -n "$NAMESPACE" patch cronjob "$CRONJOB_NAME" \
    --type merge \
    -p "{\"spec\":{\"suspend\":$value}}" >/dev/null
  echo "Set $CRONJOB_NAME suspend=$value"
}

set_max_delete_rows() {
  local rows="$1"
  if ! [[ "$rows" =~ ^[1-9][0-9]*$ ]]; then
    echo "ERROR: rows must be a positive integer." >&2
    exit 1
  fi

  patch_config_value "VFS_CRDT_COMPACTION_MAX_DELETE_ROWS" "$rows"
  echo "Set VFS_CRDT_COMPACTION_MAX_DELETE_ROWS=$rows"
}

set_schedule() {
  local schedule="$1"
  local escaped_schedule
  escaped_schedule="$(json_escape "$schedule")"

  kubectl -n "$NAMESPACE" patch cronjob "$CRONJOB_NAME" \
    --type merge \
    -p "{\"spec\":{\"schedule\":\"$escaped_schedule\"}}" >/dev/null
  echo "Set $CRONJOB_NAME schedule=$schedule"
}

run_once() {
  local job_name="${1:-vfs-crdt-compaction-manual-$(date +%s)}"
  kubectl -n "$NAMESPACE" create job --from="cronjob/$CRONJOB_NAME" "$job_name"
}

latest_job_name() {
  kubectl -n "$NAMESPACE" get jobs \
    -l "cronjob-name=$CRONJOB_NAME" \
    --sort-by=.metadata.creationTimestamp \
    -o custom-columns=NAME:.metadata.name \
    --no-headers | tail -n 1
}

latest_pod_name_for_job() {
  local job_name="$1"
  kubectl -n "$NAMESPACE" get pods \
    -l "job-name=$job_name" \
    --sort-by=.metadata.creationTimestamp \
    -o custom-columns=NAME:.metadata.name \
    --no-headers | tail -n 1
}

logs_latest() {
  local job_name
  job_name="$(latest_job_name)"
  if [[ -z "$job_name" ]]; then
    echo "No jobs found yet for cronjob/$CRONJOB_NAME" >&2
    exit 1
  fi

  local pod_name
  pod_name="$(latest_pod_name_for_job "$job_name")"
  if [[ -z "$pod_name" ]]; then
    echo "No pod found yet for job/$job_name" >&2
    exit 1
  fi

  echo "Showing logs for pod/$pod_name (job/$job_name)"
  kubectl -n "$NAMESPACE" logs "$pod_name" "$@"
}

main() {
  local command="${1:-help}"
  shift || true

  case "$command" in
    help|-h|--help)
      usage
      return
      ;;
  esac

  ensure_kubectl_context

  case "$command" in
    status)
      status
      ;;
    show-config)
      show_config
      ;;
    enable)
      set_execute "1"
      ;;
    disable)
      set_execute "0"
      ;;
    suspend)
      set_suspend "true"
      ;;
    resume)
      set_suspend "false"
      ;;
    run-once)
      run_once "${1:-}"
      ;;
    logs)
      logs_latest "$@"
      ;;
    set-max-delete-rows)
      if [[ $# -ne 1 ]]; then
        echo "ERROR: set-max-delete-rows requires exactly one argument." >&2
        exit 1
      fi
      set_max_delete_rows "$1"
      ;;
    set-schedule)
      if [[ $# -ne 1 ]]; then
        echo "ERROR: set-schedule requires exactly one argument." >&2
        exit 1
      fi
      set_schedule "$1"
      ;;
    *)
      echo "ERROR: Unknown command '$command'." >&2
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
