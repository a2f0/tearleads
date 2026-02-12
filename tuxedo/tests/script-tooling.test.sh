#!/bin/sh
set -eu

TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(cd -- "$TEST_DIR/../.." && pwd -P)
TOOL="$REPO_ROOT/scripts/tooling/scriptTool.sh"

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
if "$TOOL" unknownAction --repo-root "$REPO_ROOT" >/dev/null 2>&1; then
    fail "expected unknown action to fail"
fi
echo "Test 1 passed: unknown action fails"

# Test 2: ciImpact without required args should fail
if "$TOOL" ciImpact --repo-root "$REPO_ROOT" >/dev/null 2>&1; then
    fail "expected ciImpact without --base and --head to fail"
fi
echo "Test 2 passed: ciImpact requires --base and --head"

# Test 3: checkBinaryFiles without mode should fail
if "$TOOL" checkBinaryFiles --repo-root "$REPO_ROOT" >/dev/null 2>&1; then
    fail "expected checkBinaryFiles without --staged or --from-upstream to fail"
fi
echo "Test 3 passed: checkBinaryFiles requires mode"

# Test 4: verifyBinaryGuardrails should succeed
VERIFY_JSON="$TEMP_DIR/verifyBinaryGuardrails.json"
"$TOOL" verifyBinaryGuardrails --repo-root "$REPO_ROOT" --json >"$VERIFY_JSON"
assert_file_exists "$VERIFY_JSON"
VERIFY_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}|${d.safety_class}|${String(d.retry_safe)}`);' "$VERIFY_JSON")
assert_contains "$VERIFY_STATUS" "success|verifyBinaryGuardrails|safe_read|true"
echo "Test 4 passed: verifyBinaryGuardrails succeeds"

# Test 5: checkBinaryFiles --staged should succeed (no staged files = clean)
CHECK_JSON="$TEMP_DIR/checkBinaryFiles.json"
"$TOOL" checkBinaryFiles --staged --repo-root "$REPO_ROOT" --json >"$CHECK_JSON"
assert_file_exists "$CHECK_JSON"
CHECK_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}|${d.safety_class}`);' "$CHECK_JSON")
assert_contains "$CHECK_STATUS" "success|checkBinaryFiles|safe_read"
echo "Test 5 passed: checkBinaryFiles --staged succeeds"

# Test 6: ciImpact dry-run should succeed
CIIMPACT_JSON="$TEMP_DIR/ciImpact.json"
"$TOOL" ciImpact --base origin/main --head HEAD --repo-root "$REPO_ROOT" --dry-run --json >"$CIIMPACT_JSON"
assert_file_exists "$CIIMPACT_JSON"
CIIMPACT_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}|${String(d.dry_run)}`);' "$CIIMPACT_JSON")
assert_contains "$CIIMPACT_STATUS" "success|ciImpact|true"
echo "Test 6 passed: ciImpact dry-run succeeds"

# Test 7: runImpactedQuality dry-run should succeed
QUALITY_JSON="$TEMP_DIR/runImpactedQuality.json"
"$TOOL" runImpactedQuality --base origin/main --head HEAD --repo-root "$REPO_ROOT" --dry-run --json >"$QUALITY_JSON"
assert_file_exists "$QUALITY_JSON"
QUALITY_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}|${d.safety_class}`);' "$QUALITY_JSON")
assert_contains "$QUALITY_STATUS" "success|runImpactedQuality|safe_write_local"
echo "Test 7 passed: runImpactedQuality dry-run succeeds"

# Test 8: runImpactedTests dry-run should succeed
TESTS_JSON="$TEMP_DIR/runImpactedTests.json"
"$TOOL" runImpactedTests --base origin/main --head HEAD --repo-root "$REPO_ROOT" --dry-run --json >"$TESTS_JSON"
assert_file_exists "$TESTS_JSON"
TESTS_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}`);' "$TESTS_JSON")
assert_contains "$TESTS_STATUS" "success|runImpactedTests"
echo "Test 8 passed: runImpactedTests dry-run succeeds"

# Test 9: --help flag should show usage
HELP_OUTPUT=$("$TOOL" --help 2>&1)
assert_contains "$HELP_OUTPUT" "Usage:"
assert_contains "$HELP_OUTPUT" "Actions:"
assert_contains "$HELP_OUTPUT" "Options:"
echo "Test 9 passed: --help shows usage"

# Test 10: runAllTests dry-run should succeed
ALLTEST_JSON="$TEMP_DIR/runAllTests.json"
"$TOOL" runAllTests --repo-root "$REPO_ROOT" --dry-run --json >"$ALLTEST_JSON"
assert_file_exists "$ALLTEST_JSON"
ALLTEST_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}|${String(d.retry_safe)}`);' "$ALLTEST_JSON")
assert_contains "$ALLTEST_STATUS" "success|runAllTests|false"
echo "Test 10 passed: runAllTests dry-run succeeds"

# Test 11: runPlaywrightTests dry-run should succeed
PLAYWRIGHT_JSON="$TEMP_DIR/runPlaywrightTests.json"
"$TOOL" runPlaywrightTests --repo-root "$REPO_ROOT" --dry-run --json >"$PLAYWRIGHT_JSON"
assert_file_exists "$PLAYWRIGHT_JSON"
PLAYWRIGHT_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}`);' "$PLAYWRIGHT_JSON")
assert_contains "$PLAYWRIGHT_STATUS" "success|runPlaywrightTests"
echo "Test 11 passed: runPlaywrightTests dry-run succeeds"

# Test 12: runElectronTests dry-run should succeed
ELECTRON_JSON="$TEMP_DIR/runElectronTests.json"
"$TOOL" runElectronTests --repo-root "$REPO_ROOT" --dry-run --json >"$ELECTRON_JSON"
assert_file_exists "$ELECTRON_JSON"
ELECTRON_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}`);' "$ELECTRON_JSON")
assert_contains "$ELECTRON_STATUS" "success|runElectronTests"
echo "Test 12 passed: runElectronTests dry-run succeeds"

# Test 13: analyzeBundle dry-run should succeed
BUNDLE_JSON="$TEMP_DIR/analyzeBundle.json"
"$TOOL" analyzeBundle --repo-root "$REPO_ROOT" --dry-run --json >"$BUNDLE_JSON"
assert_file_exists "$BUNDLE_JSON"
BUNDLE_STATUS=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`${d.status}|${d.action}`);' "$BUNDLE_JSON")
assert_contains "$BUNDLE_STATUS" "success|analyzeBundle"
echo "Test 13 passed: analyzeBundle dry-run succeeds"

echo ""
echo "All tests passed."
