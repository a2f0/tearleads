#!/usr/bin/env bash
#
# Self-hosted GitHub Actions runner management script
#
# Usage:
#   ./scripts/selfHostedRunner.sh install    # Download and configure runner
#   ./scripts/selfHostedRunner.sh start      # Start runner in foreground
#   ./scripts/selfHostedRunner.sh service    # Install and start as launchd service
#   ./scripts/selfHostedRunner.sh stop       # Stop the launchd service
#   ./scripts/selfHostedRunner.sh status     # Check runner status
#   ./scripts/selfHostedRunner.sh enable     # Enable self-hosted mode (set repo variable)
#   ./scripts/selfHostedRunner.sh disable    # Disable self-hosted mode (delete repo variable)
#   ./scripts/selfHostedRunner.sh uninstall  # Remove runner and service
#   ./scripts/selfHostedRunner.sh prereqs    # Install prerequisites (mise + Homebrew)

set -euo pipefail

RUNNER_DIR="${RUNNER_DIR:-$HOME/actions-runner}"
RUNNER_VERSION="${RUNNER_VERSION:-2.331.0}"
RUNNER_GITCONFIG="${RUNNER_GITCONFIG:-$RUNNER_DIR/.gitconfig.runner}"
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "")

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

check_repo() {
  if [[ -z "$REPO" ]]; then
    log_error "Could not determine repository. Ensure you're in a git repo with a GitHub remote."
    exit 1
  fi
  log_info "Repository: $REPO"
}

ensure_mise() {
  if ! command -v mise &>/dev/null; then
    log_error "mise is required for Node.js management but was not found."
    log_error "Install mise (https://mise.jdx.dev) and rerun."
    exit 1
  fi
}

upsert_env_var() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp

  [[ -f "$file" ]] || touch "$file"
  tmp=$(mktemp)

  awk -F= -v key="$key" -v value="$value" '
    BEGIN { written = 0 }
    $1 == key {
      if (written == 0) {
        print key "=" value
        written = 1
      }
      next
    }
    { print }
    END {
      if (written == 0) {
        print key "=" value
      }
    }
  ' "$file" > "$tmp"

  mv "$tmp" "$file"
}

ensure_runner_gitconfig() {
  local runner_gitconfig="$1"
  local include_path="$HOME/.gitconfig"
  local include_exists=1

  mkdir -p "$(dirname "$runner_gitconfig")"

  if [[ ! -f "$runner_gitconfig" ]]; then
    touch "$runner_gitconfig"
  fi

  if [[ "$runner_gitconfig" != "$include_path" ]]; then
    if git config --file "$runner_gitconfig" --get-all include.path >/dev/null 2>&1; then
      git config --file "$runner_gitconfig" --get-all include.path | grep -Fxq "$include_path" || include_exists=0
    else
      include_exists=0
    fi

    if [[ "$include_exists" -eq 0 ]]; then
      if ! git config --file "$runner_gitconfig" --add include.path "$include_path"; then
        log_error "Failed to add include.path to $runner_gitconfig"
        return 1
      fi
    fi
  fi
}

cleanup_user_gitconfig_safe_directories() {
  local user_gitconfig="$HOME/.gitconfig"
  local entries
  local filtered_entries
  local runner_work_prefix="$RUNNER_DIR/_work/"

  [[ -f "$user_gitconfig" ]] || return 0

  entries="$(git config --file "$user_gitconfig" --get-all safe.directory 2>/dev/null || true)"
  [[ -n "$entries" ]] || return 0

  filtered_entries="$(printf '%s\n' "$entries" | awk -v runner_prefix="$runner_work_prefix" '
    NF == 0 { next }
    index($0, runner_prefix) == 1 { next }
    { print }
  ')"

  git config --file "$user_gitconfig" --unset-all safe.directory 2>/dev/null || true

  if [[ -n "$filtered_entries" ]]; then
    while IFS= read -r safe_dir; do
      [[ -n "$safe_dir" ]] || continue
      git config --file "$user_gitconfig" --add safe.directory "$safe_dir"
    done <<< "$filtered_entries"
  fi
}

configure_runner_git_behavior() {
  local runner_env="$RUNNER_DIR/.env"

  [[ -d "$RUNNER_DIR" ]] || return 0

  ensure_runner_gitconfig "$RUNNER_GITCONFIG"
  upsert_env_var "$runner_env" "GIT_CONFIG_GLOBAL" "$RUNNER_GITCONFIG"
  cleanup_user_gitconfig_safe_directories
}
cmd_prereqs() {
  ensure_mise
  log_info "Installing Node.js from .nvmrc via mise..."
  mise install node

  if ! command -v corepack &>/dev/null; then
    log_error "corepack was not found after activating Node via mise."
    exit 1
  fi

  log_info "Enabling pnpm via corepack..."
  corepack enable

  if ! command -v pnpm &>/dev/null; then
    log_error "pnpm is not available after corepack enable."
    exit 1
  fi

  log_info "Installing non-Node prerequisites via Homebrew..."

  if ! command -v brew &>/dev/null; then
    log_error "Homebrew not found. Install from https://brew.sh"
    exit 1
  fi

  # Core build tools (Node.js and pnpm are managed via mise/corepack).
  brew install ruby python imagemagick

  # Install ansible via pip
  log_info "Installing Ansible via pip..."
  pip3 install --user ansible ansible-lint passlib

  log_info "Prerequisites installed. You may need to:"
  echo "  - Install Xcode from the App Store (for iOS builds)"
  echo "  - Run 'xcode-select --install' for command line tools"
  echo "  - Configure Ruby version manager if needed (rbenv/rvm)"
}

cmd_install() {
  check_repo

  if [[ -d "$RUNNER_DIR" ]]; then
    log_warn "Runner directory already exists at $RUNNER_DIR"
    read -p "Remove and reinstall? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      rm -rf "$RUNNER_DIR"
    else
      exit 1
    fi
  fi

  log_info "Creating runner directory at $RUNNER_DIR"
  mkdir -p "$RUNNER_DIR"
  cd "$RUNNER_DIR"

  # Detect architecture
  ARCH=$(uname -m)
  case "$ARCH" in
    arm64) RUNNER_ARCH="osx-arm64"; ARCH_LABEL="ARM64" ;;
    x86_64) RUNNER_ARCH="osx-x64"; ARCH_LABEL="X64" ;;
    *) log_error "Unsupported architecture: $ARCH"; exit 1 ;;
  esac

  RUNNER_URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz"

  log_info "Downloading runner v${RUNNER_VERSION} for ${RUNNER_ARCH}..."
  curl -o actions-runner.tar.gz -L "$RUNNER_URL"

  log_info "Extracting runner..."
  tar xzf actions-runner.tar.gz
  rm actions-runner.tar.gz

  log_info "Fetching registration token..."
  TOKEN=$(gh api --method POST "repos/${REPO}/actions/runners/registration-token" -q .token)

  log_info "Configuring runner..."
  ./config.sh --url "https://github.com/${REPO}" --token "$TOKEN" --name "$(hostname)-self-hosted" --labels "self-hosted,macOS,${ARCH_LABEL}" --work "_work"

  # Keep checkout safe.directory writes out of the user's ~/.gitconfig.
  configure_runner_git_behavior

  log_info "Runner installed successfully!"
  echo ""
  echo "Next steps:"
  echo "  ./scripts/selfHostedRunner.sh start    # Run interactively"
  echo "  ./scripts/selfHostedRunner.sh service  # Install as background service"
}

cmd_start() {
  if [[ ! -d "$RUNNER_DIR" ]]; then
    log_error "Runner not installed. Run: ./scripts/selfHostedRunner.sh install"
    exit 1
  fi

  configure_runner_git_behavior
  export GIT_CONFIG_GLOBAL="$RUNNER_GITCONFIG"

  log_info "Starting runner in foreground (Ctrl+C to stop)..."
  cd "$RUNNER_DIR"
  ./run.sh
}

cmd_service() {
  if [[ ! -d "$RUNNER_DIR" ]]; then
    log_error "Runner not installed. Run: ./scripts/selfHostedRunner.sh install"
    exit 1
  fi

  configure_runner_git_behavior

  cd "$RUNNER_DIR"

  log_info "Installing runner as launchd service..."
  ./svc.sh install

  log_info "Starting service..."
  ./svc.sh start

  log_info "Service installed and started!"
  ./svc.sh status
}

cmd_stop() {
  if [[ ! -d "$RUNNER_DIR" ]]; then
    log_error "Runner not installed."
    exit 1
  fi

  cd "$RUNNER_DIR"

  if [[ -f "./svc.sh" ]]; then
    log_info "Stopping runner service..."
    ./svc.sh stop || true
  else
    log_warn "Service script not found. Runner may be running in foreground."
  fi
}

cmd_status() {
  check_repo

  echo ""
  log_info "=== Repository Variable ==="
  VAR_VALUE=$(gh variable get USE_SELF_HOSTED 2>/dev/null || echo "not set")
  if [[ "$VAR_VALUE" == "true" ]]; then
    echo -e "USE_SELF_HOSTED: ${GREEN}true${NC} (self-hosted mode ENABLED)"
  else
    echo -e "USE_SELF_HOSTED: ${YELLOW}${VAR_VALUE}${NC} (using GitHub-hosted runners)"
  fi

  echo ""
  log_info "=== Local Runner ==="
  if [[ -d "$RUNNER_DIR" ]]; then
    echo "Runner directory: $RUNNER_DIR"
    cd "$RUNNER_DIR"
    if [[ -f "./svc.sh" ]]; then
      ./svc.sh status 2>/dev/null || echo "Service not installed"
    fi
  else
    echo "Runner not installed locally"
  fi

  echo ""
  log_info "=== Registered Runners ==="
  gh api "repos/${REPO}/actions/runners" --jq '.runners[] | "\(.name): \(.status) (\(.labels | map(.name) | join(", ")))"' 2>/dev/null || echo "No runners registered or insufficient permissions"
}

cmd_enable() {
  check_repo
  log_info "Enabling self-hosted mode..."
  gh variable set USE_SELF_HOSTED --body "true"
  log_info "Self-hosted mode ENABLED. New workflow runs will use self-hosted runners."
}

cmd_disable() {
  check_repo
  log_info "Disabling self-hosted mode..."
  gh variable delete USE_SELF_HOSTED 2>/dev/null || true
  log_info "Self-hosted mode DISABLED. New workflow runs will use GitHub-hosted runners."
}

cmd_uninstall() {
  check_repo

  if [[ ! -d "$RUNNER_DIR" ]]; then
    log_warn "Runner directory not found at $RUNNER_DIR"
    return
  fi

  cd "$RUNNER_DIR"

  # Stop service if running
  if [[ -f "./svc.sh" ]]; then
    log_info "Stopping and uninstalling service..."
    ./svc.sh stop 2>/dev/null || true
    ./svc.sh uninstall 2>/dev/null || true
  fi

  # Remove runner from GitHub
  log_info "Fetching removal token..."
  TOKEN=$(gh api --method POST "repos/${REPO}/actions/runners/remove-token" -q .token 2>/dev/null || echo "")

  if [[ -n "$TOKEN" ]]; then
    log_info "Removing runner from GitHub..."
    ./config.sh remove --token "$TOKEN" || true
  fi

  log_info "Removing runner directory..."
  cd "$HOME"
  rm -rf "$RUNNER_DIR"

  log_info "Runner uninstalled."
}

cmd_help() {
  echo "Self-hosted GitHub Actions runner management"
  echo ""
  echo "Usage: $0 <command>"
  echo ""
  echo "Commands:"
  echo "  install     Download and configure the runner"
  echo "  start       Start runner in foreground"
  echo "  service     Install and start as launchd service"
  echo "  stop        Stop the launchd service"
  echo "  status      Check runner and variable status"
  echo "  enable      Enable self-hosted mode (set USE_SELF_HOSTED=true)"
  echo "  disable     Disable self-hosted mode (delete USE_SELF_HOSTED)"
  echo "  uninstall   Remove runner and service"
  echo "  prereqs     Install prerequisites (mise + Homebrew)"
  echo ""
  echo "Environment variables:"
  echo "  RUNNER_DIR      Runner installation directory (default: ~/actions-runner)"
  echo "  RUNNER_VERSION  Runner version to install (default: 2.331.0)"
  echo "  RUNNER_GITCONFIG  Runner-specific global git config path (default: ~/actions-runner/.gitconfig.runner)"
}

# Main
case "${1:-help}" in
  install)   cmd_install ;;
  start)     cmd_start ;;
  service)   cmd_service ;;
  stop)      cmd_stop ;;
  status)    cmd_status ;;
  enable)    cmd_enable ;;
  disable)   cmd_disable ;;
  uninstall) cmd_uninstall ;;
  prereqs)   cmd_prereqs ;;
  help|--help|-h) cmd_help ;;
  *)
    log_error "Unknown command: $1"
    cmd_help
    exit 1
    ;;
esac
