#!/bin/sh
set -eu

TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(cd -- "$TEST_DIR/../.." && pwd -P)
TOOL_SCRIPT="$REPO_ROOT/scripts/agents/tooling/agentTool.ts"
export NODE_PATH="${NODE_PATH:-}"

# Run the TypeScript tool via pnpm exec tsx
run_tool() {
    pnpm exec tsx "$TOOL_SCRIPT" "$@"
}

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

if run_tool unknownAction --repo-root "$TEST_REPO" >/dev/null 2>&1; then
    fail "expected unknown action to fail"
fi

SETTINGS_FILE="$TEST_REPO/.vscode/settings.json"

CODEX_JSON="$TEMP_DIR/solicitCodexReview.json"
run_tool solicitCodexReview --repo-root "$REPO_ROOT" --dry-run --json >"$CODEX_JSON"
assert_file_exists "$CODEX_JSON"
CODEX_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}|${String(d.dry_run)}`);' "$CODEX_JSON")
assert_contains "$CODEX_STATUS" "success|solicitCodexReview|true"

CLAUDE_JSON="$TEMP_DIR/solicitClaudeCodeReview.json"
run_tool solicitClaudeCodeReview --repo-root "$REPO_ROOT" --dry-run --json >"$CLAUDE_JSON"
assert_file_exists "$CLAUDE_JSON"
CLAUDE_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}|${String(d.dry_run)}`);' "$CLAUDE_JSON")
assert_contains "$CLAUDE_STATUS" "success|solicitClaudeCodeReview|true"

# Test --help flag
HELP_OUTPUT=$(run_tool --help 2>&1)
assert_contains "$HELP_OUTPUT" "Usage:"
assert_contains "$HELP_OUTPUT" "Commands:"
assert_contains "$HELP_OUTPUT" "Options:"
assert_contains "$HELP_OUTPUT" "replyToGemini"

# Test setVscodeTitle without --title (should use default '<workspace>')
TITLE_JSON="$TEMP_DIR/setVscodeTitle.json"
run_tool setVscodeTitle --repo-root "$TEST_REPO" --json >"$TITLE_JSON"
assert_file_exists "$TITLE_JSON"
TITLE_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}`);' "$TITLE_JSON")
assert_contains "$TITLE_STATUS" "success|setVscodeTitle"
# Verify the default title format was applied (should be '<workspace>')
DEFAULT_TITLE=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(d["window.title"] || ""));' "$SETTINGS_FILE")
assert_contains "$DEFAULT_TITLE" "repo"

# replyToGemini should require --commit
if run_tool replyToGemini --repo-root "$TEST_REPO" --number 1 --comment-id 2 >/dev/null 2>&1; then
    fail "expected replyToGemini without --commit to fail"
fi

# replyToGemini should validate SHA format
if run_tool replyToGemini --repo-root "$TEST_REPO" --number 1 --comment-id 2 --commit not-a-sha >/dev/null 2>&1; then
    fail "expected replyToGemini with invalid --commit to fail"
fi

# replyToGemini should pass argument validation in dry-run mode
GEMINI_REPLY_JSON="$TEMP_DIR/replyToGemini.json"
run_tool replyToGemini --repo-root "$TEST_REPO" --number 1 --comment-id 2 --commit abc1234 --dry-run --json >"$GEMINI_REPLY_JSON"
assert_file_exists "$GEMINI_REPLY_JSON"
GEMINI_REPLY_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}|${String(d.dry_run)}`);' "$GEMINI_REPLY_JSON")
assert_contains "$GEMINI_REPLY_STATUS" "success|replyToGemini|true"

# replyToComment should still require explicit --body
if run_tool replyToComment --repo-root "$TEST_REPO" --number 1 --comment-id 2 >/dev/null 2>&1; then
    fail "expected replyToComment without --body to fail"
fi

echo "All tests passed."
