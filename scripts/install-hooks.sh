#!/bin/sh

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOK_PATH="$REPO_ROOT/.git/hooks/pre-push"

cat > "$HOOK_PATH" << 'HOOK'
#!/bin/sh

set -e

echo "Running tests..."
cargo test

echo "Running linter..."
cargo clippy -- -D warnings

echo "All checks passed."
HOOK

chmod +x "$HOOK_PATH"
echo "pre-push hook installed at $HOOK_PATH"
