#!/bin/sh
set -eu

TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(cd -- "$TEST_DIR/../.." && pwd -P)
TOOL_SCRIPT="$REPO_ROOT/scripts/tooling/scriptTool.ts"

# Helper to invoke the TypeScript tool via pnpm exec tsx
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

# Test 1: Unknown action should fail
if run_tool unknownAction --repo-root "$REPO_ROOT" >/dev/null 2>&1; then
    fail "expected unknown action to fail"
fi
echo "Test 1 passed: unknown action fails"

# Test 2: ciImpact without required args should fail
if run_tool ciImpact --repo-root "$REPO_ROOT" >/dev/null 2>&1; then
    fail "expected ciImpact without --base and --head to fail"
fi
echo "Test 2 passed: ciImpact requires --base and --head"

# Test 3: checkBinaryFiles without mode should fail
if run_tool checkBinaryFiles --repo-root "$REPO_ROOT" >/dev/null 2>&1; then
    fail "expected checkBinaryFiles without --staged or --from-upstream to fail"
fi
echo "Test 3 passed: checkBinaryFiles requires mode"

# Test 4: verifyBinaryGuardrails should succeed
VERIFY_JSON="$TEMP_DIR/verifyBinaryGuardrails.json"
run_tool verifyBinaryGuardrails --repo-root "$REPO_ROOT" --json >"$VERIFY_JSON"
assert_file_exists "$VERIFY_JSON"
VERIFY_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}|${d.safety_class}|${String(d.retry_safe)}`);' "$VERIFY_JSON")
assert_contains "$VERIFY_STATUS" "success|verifyBinaryGuardrails|safe_read|true"
echo "Test 4 passed: verifyBinaryGuardrails succeeds"

# Test 5: checkBinaryFiles --staged should succeed (no staged files = clean)
CHECK_JSON="$TEMP_DIR/checkBinaryFiles.json"
run_tool checkBinaryFiles --staged --repo-root "$REPO_ROOT" --json >"$CHECK_JSON"
assert_file_exists "$CHECK_JSON"
CHECK_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}|${d.safety_class}`);' "$CHECK_JSON")
assert_contains "$CHECK_STATUS" "success|checkBinaryFiles|safe_read"
echo "Test 5 passed: checkBinaryFiles --staged succeeds"

# Test 6: ciImpact dry-run should succeed
CIIMPACT_JSON="$TEMP_DIR/ciImpact.json"
run_tool ciImpact --base origin/main --head HEAD --repo-root "$REPO_ROOT" --dry-run --json >"$CIIMPACT_JSON"
assert_file_exists "$CIIMPACT_JSON"
CIIMPACT_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}|${String(d.dry_run)}`);' "$CIIMPACT_JSON")
assert_contains "$CIIMPACT_STATUS" "success|ciImpact|true"
echo "Test 6 passed: ciImpact dry-run succeeds"

# Test 7: runImpactedQuality dry-run should succeed
QUALITY_JSON="$TEMP_DIR/runImpactedQuality.json"
run_tool runImpactedQuality --base origin/main --head HEAD --repo-root "$REPO_ROOT" --dry-run --json >"$QUALITY_JSON"
assert_file_exists "$QUALITY_JSON"
QUALITY_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}|${d.safety_class}`);' "$QUALITY_JSON")
assert_contains "$QUALITY_STATUS" "success|runImpactedQuality|safe_write_local"
echo "Test 7 passed: runImpactedQuality dry-run succeeds"

# Test 8: runImpactedTests dry-run should succeed
TESTS_JSON="$TEMP_DIR/runImpactedTests.json"
run_tool runImpactedTests --base origin/main --head HEAD --repo-root "$REPO_ROOT" --dry-run --json >"$TESTS_JSON"
assert_file_exists "$TESTS_JSON"
TESTS_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}`);' "$TESTS_JSON")
assert_contains "$TESTS_STATUS" "success|runImpactedTests"
echo "Test 8 passed: runImpactedTests dry-run succeeds"

# Test 9: --help flag should show usage
HELP_OUTPUT=$(run_tool --help 2>&1)
assert_contains "$HELP_OUTPUT" "Usage:"
assert_contains "$HELP_OUTPUT" "Commands:"
assert_contains "$HELP_OUTPUT" "Options:"
echo "Test 9 passed: --help shows usage"

# Test 10: runAllTests dry-run should succeed
ALLTEST_JSON="$TEMP_DIR/runAllTests.json"
run_tool runAllTests --repo-root "$REPO_ROOT" --dry-run --json >"$ALLTEST_JSON"
assert_file_exists "$ALLTEST_JSON"
ALLTEST_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}|${String(d.retry_safe)}`);' "$ALLTEST_JSON")
assert_contains "$ALLTEST_STATUS" "success|runAllTests|false"
echo "Test 10 passed: runAllTests dry-run succeeds"

# Test 11: runPlaywrightTests dry-run should succeed
PLAYWRIGHT_JSON="$TEMP_DIR/runPlaywrightTests.json"
run_tool runPlaywrightTests --repo-root "$REPO_ROOT" --dry-run --json >"$PLAYWRIGHT_JSON"
assert_file_exists "$PLAYWRIGHT_JSON"
PLAYWRIGHT_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}`);' "$PLAYWRIGHT_JSON")
assert_contains "$PLAYWRIGHT_STATUS" "success|runPlaywrightTests"
echo "Test 11 passed: runPlaywrightTests dry-run succeeds"

# Test 12: runElectronTests dry-run should succeed
ELECTRON_JSON="$TEMP_DIR/runElectronTests.json"
run_tool runElectronTests --repo-root "$REPO_ROOT" --dry-run --json >"$ELECTRON_JSON"
assert_file_exists "$ELECTRON_JSON"
ELECTRON_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}`);' "$ELECTRON_JSON")
assert_contains "$ELECTRON_STATUS" "success|runElectronTests"
echo "Test 12 passed: runElectronTests dry-run succeeds"

# Test 13: analyzeBundle dry-run should succeed
BUNDLE_JSON="$TEMP_DIR/analyzeBundle.json"
run_tool analyzeBundle --repo-root "$REPO_ROOT" --dry-run --json >"$BUNDLE_JSON"
assert_file_exists "$BUNDLE_JSON"
BUNDLE_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}`);' "$BUNDLE_JSON")
assert_contains "$BUNDLE_STATUS" "success|analyzeBundle"
echo "Test 13 passed: analyzeBundle dry-run succeeds"

# Test 14: updateEverything requires explicit --mode
if run_tool updateEverything --repo-root "$REPO_ROOT" --dry-run >/dev/null 2>&1; then
    fail "expected updateEverything without --mode to fail"
fi
echo "Test 14 passed: updateEverything requires --mode"

# Test 15: updateEverything non-dry-run requires --confirm
if run_tool updateEverything --repo-root "$REPO_ROOT" --mode quick >/dev/null 2>&1; then
    fail "expected updateEverything without --confirm to fail"
fi
echo "Test 15 passed: updateEverything requires --confirm for non-dry-run"

# Test 16: updateEverything quick dry-run should succeed
UPDATE_JSON="$TEMP_DIR/updateEverything.json"
run_tool updateEverything --repo-root "$REPO_ROOT" --mode quick --dry-run --json >"$UPDATE_JSON"
assert_file_exists "$UPDATE_JSON"
UPDATE_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}|${String(d.dry_run)}`);' "$UPDATE_JSON")
assert_contains "$UPDATE_STATUS" "success|updateEverything|true"
echo "Test 16 passed: updateEverything quick dry-run succeeds"

# Test 17: syncCliAuth should require --confirm
if run_tool syncCliAuth --repo-root "$REPO_ROOT" --host test@example.com >/dev/null 2>&1; then
    fail "expected syncCliAuth without --confirm to fail"
fi
echo "Test 17 passed: syncCliAuth requires --confirm"

# Test 18: syncCliAuth dry-run should succeed with explicit confirmation
SYNC_JSON="$TEMP_DIR/syncCliAuth.json"
run_tool syncCliAuth --repo-root "$REPO_ROOT" --host test@example.com --confirm --dry-run --json >"$SYNC_JSON"
assert_file_exists "$SYNC_JSON"
SYNC_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}|${d.safety_class}`);' "$SYNC_JSON")
assert_contains "$SYNC_STATUS" "success|syncCliAuth|safe_write_remote"
echo "Test 18 passed: syncCliAuth dry-run succeeds"

# Test 19: tuxedoKill should require --scope
if run_tool tuxedoKill --repo-root "$REPO_ROOT" --confirm >/dev/null 2>&1; then
    fail "expected tuxedoKill without --scope to fail"
fi
echo "Test 19 passed: tuxedoKill requires --scope"

# Test 20: tuxedoKill should reject unsupported scope
if run_tool tuxedoKill --repo-root "$REPO_ROOT" --scope tmux --confirm >/dev/null 2>&1; then
    fail "expected tuxedoKill with unsupported scope to fail"
fi
echo "Test 20 passed: tuxedoKill rejects unsupported scope"

# Test 21: tuxedoKill dry-run succeeds with explicit scope/confirm
TUXEDO_KILL_JSON="$TEMP_DIR/tuxedoKill.json"
run_tool tuxedoKill --repo-root "$REPO_ROOT" --scope all --confirm --dry-run --json >"$TUXEDO_KILL_JSON"
assert_file_exists "$TUXEDO_KILL_JSON"
TUXEDO_KILL_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}`);' "$TUXEDO_KILL_JSON")
assert_contains "$TUXEDO_KILL_STATUS" "success|tuxedoKill"
echo "Test 21 passed: tuxedoKill dry-run succeeds"

# Test 22: device/environment wrappers should parse dry-run options
RUNIOS_JSON="$TEMP_DIR/runIos.json"
run_tool runIos --repo-root "$REPO_ROOT" --device "iPhone 16 Pro" --dry-run --json >"$RUNIOS_JSON"
assert_file_exists "$RUNIOS_JSON"
RUNIOS_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}`);' "$RUNIOS_JSON")
assert_contains "$RUNIOS_STATUS" "success|runIos"
echo "Test 22 passed: runIos dry-run succeeds"

# Test 23: runMaestroAndroidTests dry-run should accept optional flags
MAESTRO_ANDROID_JSON="$TEMP_DIR/runMaestroAndroidTests.json"
run_tool runMaestroAndroidTests --repo-root "$REPO_ROOT" --headless --record-video --video-seconds 90 --flow dark-mode-switcher.yaml --dry-run --json >"$MAESTRO_ANDROID_JSON"
assert_file_exists "$MAESTRO_ANDROID_JSON"
MAESTRO_ANDROID_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}`);' "$MAESTRO_ANDROID_JSON")
assert_contains "$MAESTRO_ANDROID_STATUS" "success|runMaestroAndroidTests"
echo "Test 23 passed: runMaestroAndroidTests dry-run succeeds"

# Test 24: setupTuxedoRepos dry-run should accept env overrides
SETUP_TUXEDO_JSON="$TEMP_DIR/setupTuxedoRepos.json"
run_tool setupTuxedoRepos --repo-root "$REPO_ROOT" --base-dir /tmp/tux --workspace-count 4 --dry-run --json >"$SETUP_TUXEDO_JSON"
assert_file_exists "$SETUP_TUXEDO_JSON"
SETUP_TUXEDO_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}`);' "$SETUP_TUXEDO_JSON")
assert_contains "$SETUP_TUXEDO_STATUS" "success|setupTuxedoRepos"
echo "Test 24 passed: setupTuxedoRepos dry-run succeeds"

# Test 25: help output includes phase-3 actions
assert_contains "$HELP_OUTPUT" "updateEverything"
assert_contains "$HELP_OUTPUT" "runIos"
assert_contains "$HELP_OUTPUT" "syncCliAuth"
echo "Test 25 passed: --help includes phase-3 actions"

echo ""
echo "All tests passed."
