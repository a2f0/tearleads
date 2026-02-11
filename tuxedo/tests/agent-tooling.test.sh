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

if "$TOOL" setQueued --repo-root "$TEST_REPO" >/dev/null 2>&1; then
    fail "expected setQueued without --title to fail"
fi

QUEUE_JSON="$TEMP_DIR/setQueued.json"
"$TOOL" setQueued --title "(queued) #1570 - phase1" --repo-root "$TEST_REPO" --json >"$QUEUE_JSON"
assert_file_exists "$QUEUE_JSON"

QUEUE_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}|${d.safety_class}|${String(d.retry_safe)}`);' "$QUEUE_JSON")
assert_contains "$QUEUE_STATUS" "success|setQueued|safe_write_local|true"

SETTINGS_FILE="$TEST_REPO/.vscode/settings.json"
assert_file_exists "$SETTINGS_FILE"
WINDOW_TITLE=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(d["window.title"] || ""));' "$SETTINGS_FILE")
assert_contains "$WINDOW_TITLE" "(queued) #1570 - phase1"

CLEAR_JSON="$TEMP_DIR/clearQueued.json"
"$TOOL" clearQueued --repo-root "$TEST_REPO" --json >"$CLEAR_JSON"
assert_file_exists "$CLEAR_JSON"

CLEAR_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}`);' "$CLEAR_JSON")
assert_contains "$CLEAR_STATUS" "success|clearQueued"

RESET_TITLE=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(d["window.title"] || ""));' "$SETTINGS_FILE")
assert_contains "$RESET_TITLE" "repo - "

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
