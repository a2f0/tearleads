#!/bin/sh
set -eu

SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)
AGENTS_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd -P)

usage() {
    cat <<'EOF'
Usage:
  agentTool.sh <action> [options]

Actions:
  refresh
  solicitClaudeCodeReview
  solicitCodexReview
  setVscodeTitle
  addLabel
  approveSkippedChecks

Options:
  --title <value>          Title to set (optional for setVscodeTitle)
  --type <pr|issue>        Target type for addLabel (required for addLabel)
  --number <n>             PR or issue number for addLabel (required for addLabel)
  --label <name>           Label name for addLabel (required for addLabel)
  --timeout-seconds <n>    Timeout in seconds (default: 300, refresh: 3600)
  --repo-root <path>       Execute from this repo root instead of auto-detecting
  --dry-run                Validate and report without executing the target script
  --json                   Emit structured JSON summary
  -h, --help               Show help
EOF
}

require_value() {
    opt="$1"
    val="$2"
    if [ -z "$val" ]; then
        echo "Error: $opt requires a value." >&2
        exit 1
    fi
}

is_positive_int() {
    case "$1" in
        ''|*[!0-9]*) return 1 ;;
        0) return 1 ;;
        *) return 0 ;;
    esac
}

# Handle --help/-h before requiring an action
case "${1:-}" in
    -h|--help)
        usage
        exit 0
        ;;
esac

if [ "$#" -lt 1 ]; then
    usage >&2
    exit 1
fi

ACTION="$1"
shift

TITLE=""
LABEL_TYPE=""
LABEL_NUMBER=""
LABEL_NAME=""
TIMEOUT_SECONDS=""
REPO_ROOT=""
DRY_RUN=false
EMIT_JSON=false

while [ "$#" -gt 0 ]; do
    case "$1" in
        --title)
            shift
            require_value "--title" "${1:-}"
            TITLE="$1"
            ;;
        --type)
            shift
            require_value "--type" "${1:-}"
            LABEL_TYPE="$1"
            ;;
        --number)
            shift
            require_value "--number" "${1:-}"
            LABEL_NUMBER="$1"
            ;;
        --label)
            shift
            require_value "--label" "${1:-}"
            LABEL_NAME="$1"
            ;;
        --timeout-seconds)
            shift
            require_value "--timeout-seconds" "${1:-}"
            TIMEOUT_SECONDS="$1"
            ;;
        --repo-root)
            shift
            require_value "--repo-root" "${1:-}"
            REPO_ROOT="$1"
            ;;
        --dry-run)
            DRY_RUN=true
            ;;
        --json)
            EMIT_JSON=true
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Error: Unknown option '$1'." >&2
            usage >&2
            exit 1
            ;;
    esac
    shift
done

case "$ACTION" in
    refresh|setVscodeTitle|solicitCodexReview|solicitClaudeCodeReview|addLabel|approveSkippedChecks) ;;
    *)
        echo "Error: Unknown action '$ACTION'." >&2
        usage >&2
        exit 1
        ;;
esac

# setVscodeTitle defaults to '<workspace> - <branch>' when --title is not provided

# addLabel requires --type, --number, and --label
if [ "$ACTION" = "addLabel" ]; then
    if [ -z "$LABEL_TYPE" ]; then
        echo "Error: addLabel requires --type." >&2
        exit 1
    fi
    if [ -z "$LABEL_NUMBER" ]; then
        echo "Error: addLabel requires --number." >&2
        exit 1
    fi
    if [ -z "$LABEL_NAME" ]; then
        echo "Error: addLabel requires --label." >&2
        exit 1
    fi
    case "$LABEL_TYPE" in
        pr|issue) ;;
        *)
            echo "Error: --type must be 'pr' or 'issue'." >&2
            exit 1
            ;;
    esac
    if ! is_positive_int "$LABEL_NUMBER"; then
        echo "Error: --number must be a positive integer." >&2
        exit 1
    fi
fi

if [ -n "$TIMEOUT_SECONDS" ] && ! is_positive_int "$TIMEOUT_SECONDS"; then
    echo "Error: --timeout-seconds must be a positive integer." >&2
    exit 1
fi

if [ -z "$TIMEOUT_SECONDS" ]; then
    if [ "$ACTION" = "refresh" ]; then
        TIMEOUT_SECONDS=3600
    else
        TIMEOUT_SECONDS=300
    fi
fi

if [ -z "$REPO_ROOT" ]; then
    if ! REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null); then
        echo "Error: Could not detect git repository root. Use --repo-root." >&2
        exit 1
    fi
fi

case "$ACTION" in
    solicitCodexReview|solicitClaudeCodeReview|approveSkippedChecks)
        SCRIPT="$REPO_ROOT/scripts/$ACTION.sh"
        ;;
    addLabel)
        SCRIPT="$AGENTS_DIR/addLabel.sh"
        ;;
    *)
        SCRIPT="$AGENTS_DIR/$ACTION.sh"
        ;;
esac

if [ ! -x "$SCRIPT" ]; then
    echo "Error: Script not executable: $SCRIPT" >&2
    exit 1
fi

SAFETY_CLASS="safe_write_local"
RETRY_SAFE="true"
if [ "$ACTION" = "refresh" ]; then
    RETRY_SAFE="false"
fi
if [ "$ACTION" = "solicitCodexReview" ] || [ "$ACTION" = "solicitClaudeCodeReview" ]; then
    SAFETY_CLASS="safe_read"
fi
if [ "$ACTION" = "addLabel" ]; then
    SAFETY_CLASS="safe_write_remote"
fi

START_MS=$(node -e 'console.log(Date.now())')
TMP_OUTPUT=$(mktemp "${TMPDIR:-/tmp}/agentTool.XXXXXX")
trap 'rm -f "$TMP_OUTPUT"' EXIT

EXIT_CODE=0
if [ "$DRY_RUN" = true ]; then
    printf 'dry-run: would run %s from %s\n' "$SCRIPT" "$REPO_ROOT" >"$TMP_OUTPUT"
else
    if command -v timeout >/dev/null 2>&1; then
        if ! timeout "$TIMEOUT_SECONDS" sh -c '
            set -eu
            REPO_ROOT="$1"
            SCRIPT="$2"
            TITLE="$3"
            ACTION="$4"
            LABEL_TYPE="$5"
            LABEL_NUMBER="$6"
            LABEL_NAME="$7"
            cd "$REPO_ROOT"
            if [ "$ACTION" = "addLabel" ]; then
                "$SCRIPT" --type "$LABEL_TYPE" --number "$LABEL_NUMBER" --label "$LABEL_NAME"
            elif [ -n "$TITLE" ]; then
                "$SCRIPT" "$TITLE"
            else
                "$SCRIPT"
            fi
        ' _ "$REPO_ROOT" "$SCRIPT" "$TITLE" "$ACTION" "$LABEL_TYPE" "$LABEL_NUMBER" "$LABEL_NAME" >"$TMP_OUTPUT" 2>&1; then
            EXIT_CODE=$?
        fi
    else
        if ! sh -c '
            set -eu
            REPO_ROOT="$1"
            SCRIPT="$2"
            TITLE="$3"
            ACTION="$4"
            LABEL_TYPE="$5"
            LABEL_NUMBER="$6"
            LABEL_NAME="$7"
            cd "$REPO_ROOT"
            if [ "$ACTION" = "addLabel" ]; then
                "$SCRIPT" --type "$LABEL_TYPE" --number "$LABEL_NUMBER" --label "$LABEL_NAME"
            elif [ -n "$TITLE" ]; then
                "$SCRIPT" "$TITLE"
            else
                "$SCRIPT"
            fi
        ' _ "$REPO_ROOT" "$SCRIPT" "$TITLE" "$ACTION" "$LABEL_TYPE" "$LABEL_NUMBER" "$LABEL_NAME" >"$TMP_OUTPUT" 2>&1; then
            EXIT_CODE=$?
        fi
    fi
fi

END_MS=$(node -e 'console.log(Date.now())')
DURATION_MS=$((END_MS - START_MS))

STATUS="success"
if [ "$EXIT_CODE" -ne 0 ]; then
    STATUS="failure"
fi

KEY_LINES_BASE64=$(tail -n 5 "$TMP_OUTPUT" | base64 | tr -d '\n')

if [ "$EMIT_JSON" = true ]; then
    node - "$STATUS" "$EXIT_CODE" "$DURATION_MS" "$ACTION" "$REPO_ROOT" "$SAFETY_CLASS" "$RETRY_SAFE" "$DRY_RUN" "$KEY_LINES_BASE64" <<'NODE'
const [status, exitCode, durationMs, action, repoRoot, safetyClass, retrySafe, dryRun, keyLinesBase64] =
  process.argv.slice(2);
const keyLines = Buffer.from(keyLinesBase64, 'base64')
  .toString('utf8')
  .split('\n')
  .map((line) => line.trimEnd())
  .filter((line) => line.length > 0);

process.stdout.write(
  `${JSON.stringify(
    {
      status,
      exit_code: Number(exitCode),
      duration_ms: Number(durationMs),
      action,
      repo_root: repoRoot,
      safety_class: safetyClass,
      retry_safe: retrySafe === "true",
      dry_run: dryRun === "true",
      key_lines: keyLines
    },
    null,
    2
  )}\n`
);
NODE
else
    cat "$TMP_OUTPUT"
fi

if [ "$EXIT_CODE" -ne 0 ]; then
    exit "$EXIT_CODE"
fi
