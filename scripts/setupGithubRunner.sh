#!/bin/bash
# Setup a self-hosted GitHub Actions runner on macOS
# Usage: ./scripts/setupGithubRunner.sh
#
# Prerequisites:
#   - GitHub Personal Access Token with 'repo' scope
#   - Set GITHUB_TOKEN environment variable or pass via prompt
#   - jq (brew install jq)

set -euo pipefail

# Check for jq
if ! command -v jq &> /dev/null; then
  echo "Error: jq is not installed. Please install it with: brew install jq" >&2
  exit 1
fi

# Configuration
RUNNER_VERSION="2.321.0"
RUNNER_DIR="${HOME}/actions-runner"
REPO_OWNER="a2f0"
REPO_NAME="rapid"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1" >&2; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }

# Check architecture
ARCH=$(uname -m)
if [[ "$ARCH" == "arm64" ]]; then
  RUNNER_ARCH="arm64"
elif [[ "$ARCH" == "x86_64" ]]; then
  RUNNER_ARCH="x64"
else
  log_error "Unsupported architecture: $ARCH"
  exit 1
fi

log_info "Detected architecture: $ARCH (runner: $RUNNER_ARCH)"

# Check for GitHub token
if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  log_warn "GITHUB_TOKEN environment variable not set"
  echo -n "Enter your GitHub Personal Access Token: "
  read -rs GITHUB_TOKEN
  echo
fi

if [[ -z "$GITHUB_TOKEN" ]]; then
  log_error "GitHub token is required"
  exit 1
fi

# Get runner registration token from GitHub API
log_info "Fetching runner registration token..."
REGISTRATION_TOKEN=$(curl -sS -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/runners/registration-token" \
  | jq -r '.token // empty')

if [[ -z "$REGISTRATION_TOKEN" ]]; then
  log_error "Failed to get registration token. Check your GITHUB_TOKEN permissions."
  log_error "Token needs 'repo' scope for private repos or 'admin:org' for org runners."
  exit 1
fi

log_info "Registration token obtained successfully"

# Create runner directory
if [[ -d "$RUNNER_DIR" ]]; then
  log_warn "Runner directory already exists: $RUNNER_DIR"
  echo -n "Do you want to remove it and start fresh? (y/N): "
  read -r response
  if [[ "$response" =~ ^[Yy]$ ]]; then
    # Stop service if running
    if [[ -f "$RUNNER_DIR/svc.sh" ]]; then
      log_info "Stopping existing runner service..."
      cd "$RUNNER_DIR"
      sudo ./svc.sh stop 2>/dev/null || true
      sudo ./svc.sh uninstall 2>/dev/null || true
    fi
    rm -rf "$RUNNER_DIR"
  else
    log_error "Aborted. Remove the directory manually or choose a different location."
    exit 1
  fi
fi

mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

# Download runner
RUNNER_TARBALL="actions-runner-osx-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz"
RUNNER_URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${RUNNER_TARBALL}"

log_info "Downloading GitHub Actions runner v${RUNNER_VERSION}..."
curl -sSL -o "$RUNNER_TARBALL" "$RUNNER_URL"

# Verify checksum
log_info "Verifying runner checksum..."
curl -sSL -o "${RUNNER_TARBALL}.sha256sum" "${RUNNER_URL}.sha256sum"
if ! shasum -a 256 -c "${RUNNER_TARBALL}.sha256sum" --ignore-missing; then
  log_error "Checksum verification failed. The downloaded file may be corrupt."
  rm -f "$RUNNER_TARBALL" "${RUNNER_TARBALL}.sha256sum"
  exit 1
fi
rm "${RUNNER_TARBALL}.sha256sum"

# Extract
log_info "Extracting runner..."
tar xzf "$RUNNER_TARBALL"
rm "$RUNNER_TARBALL"

# Configure runner
log_info "Configuring runner..."
./config.sh \
  --url "https://github.com/${REPO_OWNER}/${REPO_NAME}" \
  --token "$REGISTRATION_TOKEN" \
  --name "$(hostname)-$(date +%s)" \
  --labels "self-hosted,macOS,${RUNNER_ARCH}" \
  --work "_work" \
  --replace

# Create .env file for environment variables
log_info "Creating environment configuration..."
cat > .env << EOF
# GitHub Actions Runner Environment Variables
ImageOS=macos$(sw_vers -productVersion | cut -d. -f1)
RUNNER_TRACKING_ID=
EOF

log_info "Runner configured successfully!"
log_info "Runner is registered with labels: self-hosted, macOS, ${RUNNER_ARCH}"
echo ""
echo "Starting runner in foreground (press Ctrl+C to stop)..."
echo "To restart later: cd ${RUNNER_DIR} && ./run.sh"
echo ""

# Start the runner in foreground
exec ./run.sh
