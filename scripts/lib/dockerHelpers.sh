# shellcheck shell=bash
detect_timeout_binary() {
  if command -v timeout >/dev/null 2>&1; then
    echo "timeout"
    return
  fi
  if command -v gtimeout >/dev/null 2>&1; then
    echo "gtimeout"
    return
  fi
  echo ""
}

run_with_optional_timeout() {
  local timeout_bin="$1"
  local timeout_seconds="$2"
  shift 2

  if [[ -n "$timeout_bin" ]]; then
    "$timeout_bin" "$timeout_seconds" "$@"
    return
  fi
  "$@"
}

ensure_docker_daemon_ready() {
  local timeout_bin="$1"
  local daemon_timeout_seconds="$2"

  if ! command -v docker >/dev/null 2>&1; then
    echo "Error: docker CLI is not installed or not in PATH."
    exit 1
  fi

  local docker_server_version=""
  local docker_status=0

  set +e
  docker_server_version="$(run_with_optional_timeout "$timeout_bin" "$daemon_timeout_seconds" docker version --format '{{.Server.Version}}' 2>/dev/null)"
  docker_status=$?
  set -e

  if [[ "$docker_status" -ne 0 || -z "$docker_server_version" || "$docker_server_version" == "<no value>" ]]; then
    if [[ -n "$timeout_bin" && "$docker_status" -eq 124 ]]; then
      echo "Error: Docker daemon health check timed out after ${daemon_timeout_seconds}s."
    else
      echo "Error: Docker daemon is not reachable."
    fi
    echo "Start Docker Desktop (or Docker daemon) and retry."
    exit 1
  fi
}

docker_login_to_ecr() {
  local timeout_bin="$1"
  local login_timeout_seconds="$2"
  local aws_region="$3"
  local ecr_registry="$4"

  local ecr_password=""
  if ! ecr_password="$(aws ecr get-login-password --region "$aws_region")"; then
    echo "Error: Failed to retrieve ECR login password for region $aws_region."
    exit 1
  fi

  local login_status=0
  set +e
  run_with_optional_timeout "$timeout_bin" "$login_timeout_seconds" docker login --username AWS --password-stdin "$ecr_registry" <<<"$ecr_password"
  login_status=$?
  set -e

  if [[ "$login_status" -ne 0 ]]; then
    if [[ -n "$timeout_bin" && "$login_status" -eq 124 ]]; then
      echo "Error: docker login timed out after ${login_timeout_seconds}s."
      echo "Docker may be unresponsive. Check Docker Desktop health and retry."
    else
      echo "Error: docker login failed for $ecr_registry."
      echo "Verify Docker daemon health and AWS credentials, then retry."
    fi
    exit 1
  fi
}

run_docker_maintenance_safe() {
  local maintenance_enabled="$1"
  local maintenance_until="$2"
  local maintenance_max_cache="$3"

  [[ "$maintenance_enabled" == "true" ]] || return

  echo "=== Running Docker maintenance (safe mode) ==="
  docker container prune -f --filter "until=24h" || echo "Warning: Failed to prune stopped containers"
  docker image prune -f --filter "until=${maintenance_until}" || echo "Warning: Failed to prune dangling images"
  # Keep container prune conservative; stale containers are usually smaller than cache layers.
  if docker builder prune --help 2>/dev/null | grep -q -- "--max-used-space"; then
    docker builder prune -f --filter "until=${maintenance_until}" --max-used-space "${maintenance_max_cache}" \
      || echo "Warning: Failed to prune build cache with --max-used-space"
  else
    docker builder prune -f --filter "until=${maintenance_until}" --keep-storage "${maintenance_max_cache}" \
      || echo "Warning: Failed to prune build cache with --keep-storage"
  fi
  docker system df || true
  echo ""
}

require_option_value() {
  local option_name="$1"
  local option_value="${2:-}"
  if [[ -z "$option_value" ]]; then
    echo "Error: $option_name requires a value"
    exit 1
  fi
}
