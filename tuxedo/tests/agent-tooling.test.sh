#!/bin/sh
set -eu

TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(cd -- "$TEST_DIR/../.." && pwd -P)
TOOL="$REPO_ROOT/scripts/agents/tooling/agentTool.sh"

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

assert_contains() {
    haystack="$1"
    needle="$2"
    case "$haystack" in
        *"$needle"*) return 0 ;;
        *) fail "expected '$haystack' to contain '$needle'" ;;
    esac
}

assert_file_exists() {
    [ -f "$1" ] || fail "expected file to exist: $1"
}

TEMP_DIR=$(mktemp -d)
cleanup() {
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

TEST_REPO="$TEMP_DIR/repo"
mkdir -p "$TEST_REPO"
git -C "$TEST_REPO" init -q
git -C "$TEST_REPO" config user.email "agent-test@example.com"
git -C "$TEST_REPO" config user.name "agent-test"
touch "$TEST_REPO/.keep"
git -C "$TEST_REPO" add .keep
git -C "$TEST_REPO" commit -qm "init"

if "$TOOL" unknownAction --repo-root "$TEST_REPO" >/dev/null 2>&1; then
    fail "expected unknown action to fail"
fi

SETTINGS_FILE="$TEST_REPO/.vscode/settings.json"

CODEX_JSON="$TEMP_DIR/solicitCodexReview.json"
"$TOOL" solicitCodexReview --repo-root "$REPO_ROOT" --dry-run --json >"$CODEX_JSON"
assert_file_exists "$CODEX_JSON"
CODEX_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}|${String(d.dry_run)}`);' "$CODEX_JSON")
assert_contains "$CODEX_STATUS" "success|solicitCodexReview|true"

CLAUDE_JSON="$TEMP_DIR/solicitClaudeCodeReview.json"
"$TOOL" solicitClaudeCodeReview --repo-root "$REPO_ROOT" --dry-run --json >"$CLAUDE_JSON"
assert_file_exists "$CLAUDE_JSON"
CLAUDE_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}|${String(d.dry_run)}`);' "$CLAUDE_JSON")
assert_contains "$CLAUDE_STATUS" "success|solicitClaudeCodeReview|true"

# Test --help flag
HELP_OUTPUT=$("$TOOL" --help 2>&1)
assert_contains "$HELP_OUTPUT" "Usage:"
assert_contains "$HELP_OUTPUT" "Actions:"
assert_contains "$HELP_OUTPUT" "Options:"

# Test setVscodeTitle without --title (should use default '<workspace>')
TITLE_JSON="$TEMP_DIR/setVscodeTitle.json"
"$TOOL" setVscodeTitle --repo-root "$TEST_REPO" --json >"$TITLE_JSON"
assert_file_exists "$TITLE_JSON"
TITLE_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}`);' "$TITLE_JSON")
assert_contains "$TITLE_STATUS" "success|setVscodeTitle"
# Verify the default title format was applied (should be '<workspace>')
DEFAULT_TITLE=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(d["window.title"] || ""));' "$SETTINGS_FILE")
assert_contains "$DEFAULT_TITLE" "repo"

echo "All tests passed."
