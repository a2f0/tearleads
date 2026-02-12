#!/bin/sh
set -eu

# Phase 2 Script Tool Wrapper
# Provides safe tool-calling interface for utility scripts in scripts/

SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)
SCRIPTS_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd -P)

usage() {
    cat <<'EOF'
Usage:
  scriptTool.sh <action> [options]

Actions:
  analyzeBundle           Build and open bundle analysis report
  checkBinaryFiles        Check for binary files (guardrail)
  ciImpact                Analyze CI impact for changed files
  runImpactedQuality      Run quality checks on impacted files
  runImpactedTests        Run tests on impacted packages
  runAllTests             Run full test suite
  runElectronTests        Run Electron E2E tests
  runPlaywrightTests      Run Playwright E2E tests
  verifyBinaryGuardrails  Verify binary guardrail configuration

Options:
  --base <sha>           Base commit for diff (ciImpact, runImpactedQuality, runImpactedTests)
  --head <sha>           Head commit for diff (ciImpact, runImpactedQuality, runImpactedTests)
  --staged               Check staged files (checkBinaryFiles)
  --from-upstream        Check files changed from upstream (checkBinaryFiles)
  --headed               Run tests with visible browser (runAllTests, runPlaywrightTests, runElectronTests)
  --filter <pattern>     Test filter pattern (runPlaywrightTests, runElectronTests)
  --file <path>          Specific test file (runPlaywrightTests, runElectronTests)
  --timeout-seconds <n>  Timeout in seconds (default varies by action)
  --repo-root <path>     Execute from this repo root instead of auto-detecting
  --dry-run              Validate and report without executing the target script
  --json                 Emit structured JSON summary
  -h, --help             Show help
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

BASE_SHA=""
HEAD_SHA=""
STAGED=false
FROM_UPSTREAM=false
HEADED=false
FILTER=""
TEST_FILE=""
TIMEOUT_SECONDS=""
REPO_ROOT=""
DRY_RUN=false
EMIT_JSON=false

while [ "$#" -gt 0 ]; do
    case "$1" in
        --base)
            shift
            require_value "--base" "${1:-}"
            BASE_SHA="$1"
            ;;
        --head)
            shift
            require_value "--head" "${1:-}"
            HEAD_SHA="$1"
            ;;
        --staged)
            STAGED=true
            ;;
        --from-upstream)
            FROM_UPSTREAM=true
            ;;
        --headed)
            HEADED=true
            ;;
        --filter)
            shift
            require_value "--filter" "${1:-}"
            FILTER="$1"
            ;;
        --file)
            shift
            require_value "--file" "${1:-}"
            TEST_FILE="$1"
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

# Validate action
case "$ACTION" in
    analyzeBundle|checkBinaryFiles|ciImpact|runImpactedQuality|runImpactedTests|runAllTests|runElectronTests|runPlaywrightTests|verifyBinaryGuardrails) ;;
    *)
        echo "Error: Unknown action '$ACTION'." >&2
        usage >&2
        exit 1
        ;;
esac

# Validate required arguments per action
case "$ACTION" in
    ciImpact|runImpactedQuality|runImpactedTests)
        if [ -z "$BASE_SHA" ] || [ -z "$HEAD_SHA" ]; then
            echo "Error: $ACTION requires --base and --head arguments." >&2
            exit 1
        fi
        ;;
    checkBinaryFiles)
        if [ "$STAGED" = false ] && [ "$FROM_UPSTREAM" = false ]; then
            echo "Error: checkBinaryFiles requires --staged or --from-upstream." >&2
            exit 1
        fi
        ;;
esac

# Validate timeout
if [ -n "$TIMEOUT_SECONDS" ] && ! is_positive_int "$TIMEOUT_SECONDS"; then
    echo "Error: --timeout-seconds must be a positive integer." >&2
    exit 1
fi

# Set default timeouts per action
if [ -z "$TIMEOUT_SECONDS" ]; then
    case "$ACTION" in
        runAllTests)
            TIMEOUT_SECONDS=3600
            ;;
        runElectronTests|runPlaywrightTests)
            TIMEOUT_SECONDS=1800
            ;;
        analyzeBundle)
            TIMEOUT_SECONDS=600
            ;;
        *)
            TIMEOUT_SECONDS=300
            ;;
    esac
fi

# Resolve repo root
if [ -z "$REPO_ROOT" ]; then
    if ! REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null); then
        echo "Error: Could not detect git repository root. Use --repo-root." >&2
        exit 1
    fi
fi

# Map action to script path
resolve_script() {
    case "$ACTION" in
        analyzeBundle)
            SCRIPT="$REPO_ROOT/scripts/analyzeBundle.sh"
            ;;
        checkBinaryFiles)
            SCRIPT="$REPO_ROOT/scripts/checkBinaryFiles.sh"
            ;;
        ciImpact)
            SCRIPT="$REPO_ROOT/scripts/ciImpact/ciImpact.ts"
            ;;
        runImpactedQuality)
            SCRIPT="$REPO_ROOT/scripts/ciImpact/runImpactedQuality.ts"
            ;;
        runImpactedTests)
            SCRIPT="$REPO_ROOT/scripts/ciImpact/runImpactedTests.ts"
            ;;
        runAllTests)
            SCRIPT="$REPO_ROOT/scripts/runAllTests.sh"
            ;;
        runElectronTests)
            SCRIPT="$REPO_ROOT/scripts/runElectronTests.sh"
            ;;
        runPlaywrightTests)
            SCRIPT="$REPO_ROOT/scripts/runPlaywrightTests.sh"
            ;;
        verifyBinaryGuardrails)
            SCRIPT="$REPO_ROOT/scripts/verifyBinaryGuardrails.sh"
            ;;
    esac
}


resolve_script

if [ ! -f "$SCRIPT" ]; then
    echo "Error: Script not found: $SCRIPT" >&2
    exit 1
fi

# Determine safety class and retry-safe status
case "$ACTION" in
    ciImpact|checkBinaryFiles|verifyBinaryGuardrails)
        SAFETY_CLASS="safe_read"
        RETRY_SAFE="true"
        ;;
    analyzeBundle)
        SAFETY_CLASS="safe_write_local"
        RETRY_SAFE="true"
        ;;
    runImpactedQuality|runImpactedTests|runAllTests|runElectronTests|runPlaywrightTests)
        SAFETY_CLASS="safe_write_local"
        RETRY_SAFE="false"
        ;;
esac

START_MS=$(node -e 'console.log(Date.now())')
TMP_OUTPUT=$(mktemp "${TMPDIR:-/tmp}/scriptTool.XXXXXX")
trap 'rm -f "$TMP_OUTPUT"' EXIT

EXIT_CODE=0
if [ "$DRY_RUN" = true ]; then
    printf 'dry-run: would run %s for action %s from %s\n' "$SCRIPT" "$ACTION" "$REPO_ROOT" >"$TMP_OUTPUT"
else
    if command -v timeout >/dev/null 2>&1; then
        if ! timeout "$TIMEOUT_SECONDS" sh -c "$(cat <<'RUNNER_SCRIPT'
set -eu
# Import all variables needed for run_script
ACTION="$1"
REPO_ROOT="$2"
SCRIPT="$3"
STAGED="$4"
FROM_UPSTREAM="$5"
BASE_SHA="$6"
HEAD_SHA="$7"
HEADED="$8"
FILTER="$9"
shift 9
TEST_FILE="$1"

cd "$REPO_ROOT" || exit 1

case "$ACTION" in
    analyzeBundle|verifyBinaryGuardrails)
        "$SCRIPT"
        ;;
    checkBinaryFiles)
        if [ "$STAGED" = true ]; then
            "$SCRIPT" --staged
        elif [ "$FROM_UPSTREAM" = true ]; then
            "$SCRIPT" --from-upstream
        fi
        ;;
    ciImpact|runImpactedQuality|runImpactedTests)
        pnpm exec tsx "$SCRIPT" --base "$BASE_SHA" --head "$HEAD_SHA"
        ;;
    runAllTests)
        if [ "$HEADED" = true ]; then
            "$SCRIPT" --headed
        else
            "$SCRIPT"
        fi
        ;;
    runElectronTests|runPlaywrightTests)
        # Build argument list safely without eval
        if [ "$HEADED" = true ] && [ -n "$FILTER" ] && [ -n "$TEST_FILE" ]; then
            "$SCRIPT" --headed -g "$FILTER" "$TEST_FILE"
        elif [ "$HEADED" = true ] && [ -n "$FILTER" ]; then
            "$SCRIPT" --headed -g "$FILTER"
        elif [ "$HEADED" = true ] && [ -n "$TEST_FILE" ]; then
            "$SCRIPT" --headed "$TEST_FILE"
        elif [ -n "$FILTER" ] && [ -n "$TEST_FILE" ]; then
            "$SCRIPT" -g "$FILTER" "$TEST_FILE"
        elif [ "$HEADED" = true ]; then
            "$SCRIPT" --headed
        elif [ -n "$FILTER" ]; then
            "$SCRIPT" -g "$FILTER"
        elif [ -n "$TEST_FILE" ]; then
            "$SCRIPT" "$TEST_FILE"
        else
            "$SCRIPT"
        fi
        ;;
esac
RUNNER_SCRIPT
)" _ "$ACTION" "$REPO_ROOT" "$SCRIPT" "$STAGED" "$FROM_UPSTREAM" "$BASE_SHA" "$HEAD_SHA" "$HEADED" "$FILTER" "$TEST_FILE" >"$TMP_OUTPUT" 2>&1; then
            EXIT_CODE=$?
        fi
    else
        if ! sh -c "$(cat <<'RUNNER_SCRIPT'
set -eu
# Import all variables needed for run_script
ACTION="$1"
REPO_ROOT="$2"
SCRIPT="$3"
STAGED="$4"
FROM_UPSTREAM="$5"
BASE_SHA="$6"
HEAD_SHA="$7"
HEADED="$8"
FILTER="$9"
shift 9
TEST_FILE="$1"

cd "$REPO_ROOT" || exit 1

case "$ACTION" in
    analyzeBundle|verifyBinaryGuardrails)
        "$SCRIPT"
        ;;
    checkBinaryFiles)
        if [ "$STAGED" = true ]; then
            "$SCRIPT" --staged
        elif [ "$FROM_UPSTREAM" = true ]; then
            "$SCRIPT" --from-upstream
        fi
        ;;
    ciImpact|runImpactedQuality|runImpactedTests)
        pnpm exec tsx "$SCRIPT" --base "$BASE_SHA" --head "$HEAD_SHA"
        ;;
    runAllTests)
        if [ "$HEADED" = true ]; then
            "$SCRIPT" --headed
        else
            "$SCRIPT"
        fi
        ;;
    runElectronTests|runPlaywrightTests)
        # Build argument list safely without eval
        if [ "$HEADED" = true ] && [ -n "$FILTER" ] && [ -n "$TEST_FILE" ]; then
            "$SCRIPT" --headed -g "$FILTER" "$TEST_FILE"
        elif [ "$HEADED" = true ] && [ -n "$FILTER" ]; then
            "$SCRIPT" --headed -g "$FILTER"
        elif [ "$HEADED" = true ] && [ -n "$TEST_FILE" ]; then
            "$SCRIPT" --headed "$TEST_FILE"
        elif [ -n "$FILTER" ] && [ -n "$TEST_FILE" ]; then
            "$SCRIPT" -g "$FILTER" "$TEST_FILE"
        elif [ "$HEADED" = true ]; then
            "$SCRIPT" --headed
        elif [ -n "$FILTER" ]; then
            "$SCRIPT" -g "$FILTER"
        elif [ -n "$TEST_FILE" ]; then
            "$SCRIPT" "$TEST_FILE"
        else
            "$SCRIPT"
        fi
        ;;
esac
RUNNER_SCRIPT
)" _ "$ACTION" "$REPO_ROOT" "$SCRIPT" "$STAGED" "$FROM_UPSTREAM" "$BASE_SHA" "$HEAD_SHA" "$HEADED" "$FILTER" "$TEST_FILE" >"$TMP_OUTPUT" 2>&1; then
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
