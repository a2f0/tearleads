#!/bin/sh

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_SRC="$REPO_ROOT/scripts/git/hooks"
HOOKS_DST="$REPO_ROOT/.git/hooks"

install_hook_file() {
  hook_path="$1"
  hook_name="$(basename "$hook_path")"
  cp "$hook_path" "$HOOKS_DST/$hook_name"
  chmod +x "$HOOKS_DST/$hook_name"
  echo "Installed $hook_name hook"
}

install_commit_msg_hook() {
  cat > "$HOOKS_DST/commit-msg" <<'EOF'
#!/bin/sh

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"

cd "$REPO_ROOT"

echo "Linting commit message..."
bun run lint:commit-msg -- "$1"
EOF
  chmod +x "$HOOKS_DST/commit-msg"
  echo "Installed commit-msg hook"
}

for hook in "$HOOKS_SRC"/*; do
  if [ -f "$hook" ]; then
    install_hook_file "$hook"
  fi
done

install_commit_msg_hook
