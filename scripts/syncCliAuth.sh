#!/bin/sh
# Sync Claude Code and Codex CLI authentication to a remote server.
# This extracts credentials from macOS keychain and copies them to the server.
#
# Usage: ./scripts/syncCliAuth.sh <user@host>
#
# Example: ./scripts/syncCliAuth.sh ubuntu@tuxedo.example.com

set -eu

if [ $# -lt 1 ]; then
  echo "Usage: $0 <user@host>"
  echo "Example: $0 ubuntu@tuxedo.example.com"
  exit 1
fi

REMOTE_HOST="$1"
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

echo "==> Extracting Claude Code credentials from keychain..."
CLAUDE_CREDS=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null || true)
if [ -n "$CLAUDE_CREDS" ]; then
  echo "$CLAUDE_CREDS" > "$TEMP_DIR/claude-credentials.json"
  echo "    Claude credentials extracted"
else
  echo "    Warning: Could not extract Claude credentials from keychain"
fi

echo "==> Copying Codex auth..."
if [ -f "$HOME/.codex/auth.json" ]; then
  cp "$HOME/.codex/auth.json" "$TEMP_DIR/codex-auth.json"
  echo "    Codex auth copied"
else
  echo "    Warning: ~/.codex/auth.json not found"
fi

echo "==> Syncing to $REMOTE_HOST..."

# Create directories on remote
ssh "$REMOTE_HOST" 'mkdir -p ~/.claude ~/.codex && chmod 700 ~/.claude ~/.codex'

# Copy Claude credentials (stored in ~/.claude/.credentials.json on Linux)
if [ -f "$TEMP_DIR/claude-credentials.json" ]; then
  scp -q "$TEMP_DIR/claude-credentials.json" "$REMOTE_HOST:~/.claude/.credentials.json"
  ssh "$REMOTE_HOST" 'chmod 600 ~/.claude/.credentials.json'
  echo "    Claude credentials synced to ~/.claude/.credentials.json"
fi

# Copy Codex auth
if [ -f "$TEMP_DIR/codex-auth.json" ]; then
  scp -q "$TEMP_DIR/codex-auth.json" "$REMOTE_HOST:~/.codex/auth.json"
  ssh "$REMOTE_HOST" 'chmod 600 ~/.codex/auth.json'
  echo "    Codex auth synced to ~/.codex/auth.json"
fi

echo "==> Done!"
echo ""
echo "Note: Claude Code on Linux reads credentials from ~/.claude/.credentials.json"
echo "      Codex reads from ~/.codex/auth.json"
