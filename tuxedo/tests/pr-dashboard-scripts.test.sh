#!/bin/sh
set -eu

TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(cd -- "$TEST_DIR/../.." && pwd -P)

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

TEMP_DIR=$(mktemp -d)
cleanup() {
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

OPEN_SCRIPT="$REPO_ROOT/tuxedo/scripts/listOpenPrs.sh"
CLOSED_SCRIPT="$REPO_ROOT/tuxedo/scripts/listRecentClosedPrs.sh"

GH_LOG="$TEMP_DIR/gh.log"
cat <<'EOF' > "$TEMP_DIR/gh"
#!/bin/sh
set -eu
LOG_FILE="${GH_LOG:?missing GH_LOG}"
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
    echo "a2f0/tearleads"
    exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
    shift 2
    echo "$*" >> "$LOG_FILE"
    echo "1 test-pr test-branch OPEN 2026-02-09T00:00:00Z"
    exit 0
fi
echo "unexpected gh command: $*" >&2
exit 1
EOF
chmod +x "$TEMP_DIR/gh"

PATH_BACKUP="$PATH"
export GH_LOG
PATH="$TEMP_DIR:$PATH_BACKUP"

open_output=$("$OPEN_SCRIPT" --limit 5)
assert_contains "$open_output" "Open PRs ("
assert_contains "$open_output" "Repo: a2f0/tearleads"
assert_contains "$open_output" "test-pr"

closed_output=$("$CLOSED_SCRIPT" --limit 7)
assert_contains "$closed_output" "Recent Closed PRs ("
assert_contains "$closed_output" "Repo: a2f0/tearleads"
assert_contains "$closed_output" "test-pr"

gh_calls=$(cat "$GH_LOG")
assert_contains "$gh_calls" "--search is:pr is:open sort:updated-desc --limit 5"
assert_contains "$gh_calls" "--search is:pr is:closed sort:created-desc --limit 7"

help_output=$("$OPEN_SCRIPT" --help)
assert_contains "$help_output" "Usage: listOpenPrs.sh [--watch] [--interval SECONDS] [--limit COUNT]"

PATH="$PATH_BACKUP"
