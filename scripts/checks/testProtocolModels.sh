#!/usr/bin/env sh

set -eu

fail() {
  echo "Error: $*" >&2
  exit 1
}

assert_contains() {
  value=$1
  expected=$2

  case "$value" in
    *"$expected"*) ;;
    *) fail "expected output to contain '$expected'." ;;
  esac
}

# The assertions below pick their own parallelism; a value exported by the
# caller must not change them.
unset PROTOCOL_TLC_PARALLELISM

SOURCE_ROOT=$(git rev-parse --show-toplevel)
CHECK_SCRIPT=$SOURCE_ROOT/scripts/checks/checkProtocolModels.sh
FIXTURE_ROOT=$SOURCE_ROOT/scripts/checks/fixtures/protocolModels
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/protocol-models.XXXXXX")
JAVA_LOG=$TEST_ROOT/java.log

trap 'rm -rf "$TEST_ROOT"' EXIT
trap 'exit 1' HUP INT TERM

git init --quiet --initial-branch=main "$TEST_ROOT"
mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/tla-tools"
cp -R "$FIXTURE_ROOT/formal" "$TEST_ROOT/formal"
cp "$FIXTURE_ROOT/fakeJava.sh" "$TEST_ROOT/bin/java"
cp "$FIXTURE_ROOT/fakeMise.sh" "$TEST_ROOT/bin/mise"
cp "$FIXTURE_ROOT/tla2tools.jar" "$TEST_ROOT/tla-tools/tla2tools.jar"
chmod +x "$TEST_ROOT/bin/java" "$TEST_ROOT/bin/mise"

if command -v sha256sum >/dev/null 2>&1; then
  FIXTURE_JAR_SHA256=$(sha256sum "$TEST_ROOT/tla-tools/tla2tools.jar" | cut -d ' ' -f 1)
else
  FIXTURE_JAR_SHA256=$(shasum -a 256 "$TEST_ROOT/tla-tools/tla2tools.jar" | cut -d ' ' -f 1)
fi

run_check() (
  cd "$TEST_ROOT"
  PATH="$TEST_ROOT/bin:$PATH" \
    FAKE_JAVA="$TEST_ROOT/bin/java" \
    FAKE_JAVA_LOG="$JAVA_LOG" \
    FAKE_TLA_TOOLS_ROOT="$TEST_ROOT/tla-tools" \
    FAKE_FAIL_CONFIG="${FAKE_FAIL_CONFIG:-}" \
    FAKE_FAIL_MODEL="${FAKE_FAIL_MODEL:-}" \
    FAKE_FAIL_STATUS="${FAKE_FAIL_STATUS:-}" \
    PROTOCOL_TLC_PARALLELISM="${PROTOCOL_TLC_PARALLELISM:-}" \
    TLA_TOOLS_JAR_SHA256="${TLA_TOOLS_JAR_SHA256:-$FIXTURE_JAR_SHA256}" \
    "$CHECK_SCRIPT"
)

install_registry() {
  cp "$FIXTURE_ROOT/$1" "$TEST_ROOT/formal/protocol-models.txt"
  rm -f "$JAVA_LOG"
}

assert_validation_failure() {
  registry=$1
  expected=$2
  install_registry "$registry"

  if validation_output=$(run_check 2>&1); then
    fail "$registry was accepted."
  else
    validation_status=$?
  fi

  [ "$validation_status" -eq 1 ] ||
    fail "$registry exited $validation_status instead of 1."
  assert_contains "$validation_output" "$expected"
  [ ! -e "$JAVA_LOG" ] || fail "$registry launched Java before validation finished."
}

install_registry valid.txt
valid_output=$(run_check)
assert_contains "$valid_output" "Checked 3 protocol model configuration(s)."

# Overlapping runs start in no fixed order, so the launch log is unordered; the
# reported order must still follow the registry.
actual_runs=$(cut -d '|' -f 1,2 "$JAVA_LOG" | LC_ALL=C sort)
expected_runs='formal/alpha/Alpha.tla|formal/alpha/Alpha.cfg
formal/alpha/Alpha.tla|formal/alpha/AlphaBroad.cfg
formal/zeta/Zeta.tla|formal/zeta/Zeta.cfg'
[ "$actual_runs" = "$expected_runs" ] ||
  fail "registered models did not all run."

reported_runs=$(printf '%s\n' "$valid_output" | sed -n 's/^Checking \(.*\)\.\.\.$/\1/p')
expected_reported_runs='formal/alpha/Alpha.tla with formal/alpha/Alpha.cfg
formal/alpha/Alpha.tla with formal/alpha/AlphaBroad.cfg
formal/zeta/Zeta.tla with formal/zeta/Zeta.cfg'
[ "$reported_runs" = "$expected_reported_runs" ] ||
  fail "registered models were not reported in deterministic order."

metadir_count=$(cut -d '|' -f 3 "$JAVA_LOG" | LC_ALL=C sort -u | wc -l | tr -d '[:space:]')
[ "$metadir_count" -eq 3 ] || fail "TLC runs did not receive distinct state directories."

# Concurrent runs sharing java.io.tmpdir corrupt each other's standard modules.
tmpdir_count=$(cut -d '|' -f 4 "$JAVA_LOG" | LC_ALL=C sort -u | wc -l | tr -d '[:space:]')
[ "$tmpdir_count" -eq 3 ] || fail "TLC runs did not receive distinct Java tmpdirs."

# One run at a time, a failure must stop the check before the next run starts.
# With overlapping runs, which later runs had already started depends on
# timing, so only the reported failure is asserted there.
for parallelism in 1 2; do
  install_registry valid.txt
  if failure_output=$(
    FAKE_FAIL_CONFIG=formal/alpha/AlphaBroad.cfg \
      FAKE_FAIL_STATUS=17 \
      PROTOCOL_TLC_PARALLELISM=$parallelism \
      run_check 2>&1
  ); then
    fail "a TLC failure was accepted at parallelism $parallelism."
  else
    failure_status=$?
  fi

  [ "$failure_status" -eq 17 ] ||
    fail "TLC exit 17 was reported as $failure_status at parallelism $parallelism."
  assert_contains "$failure_output" "TLC failed for formal/alpha/Alpha.tla with formal/alpha/AlphaBroad.cfg."
  if [ "$parallelism" -eq 1 ]; then
    [ "$(wc -l <"$JAVA_LOG" | tr -d '[:space:]')" -eq 2 ] ||
      fail "the checker did not stop after the first TLC failure."
  fi
done

for parallelism in 0 two; do
  install_registry valid.txt
  if parallelism_output=$(PROTOCOL_TLC_PARALLELISM=$parallelism run_check 2>&1); then
    fail "PROTOCOL_TLC_PARALLELISM=$parallelism was accepted."
  fi
  assert_contains "$parallelism_output" "PROTOCOL_TLC_PARALLELISM must be a positive integer."
  [ ! -e "$JAVA_LOG" ] ||
    fail "PROTOCOL_TLC_PARALLELISM=$parallelism launched Java anyway."
done

# A tla2tools.jar whose bytes do not match the pin must fail before TLC runs.
install_registry valid.txt
if pin_output=$(TLA_TOOLS_JAR_SHA256=deadbeef run_check 2>&1); then
  fail "a jar with a mismatched sha256 pin was accepted."
else
  pin_status=$?
fi
[ "$pin_status" -eq 1 ] ||
  fail "a mismatched jar pin exited $pin_status instead of 1."
assert_contains "$pin_output" "does not match the pinned deadbeef"
[ ! -e "$JAVA_LOG" ] ||
  fail "a mismatched jar pin launched Java anyway."

# A model file with no registered configuration must fail loudly instead of
# silently dropping out of checking.
mkdir -p "$TEST_ROOT/formal/helper"
printf -- '---- MODULE Helper ----\n====\n' >"$TEST_ROOT/formal/helper/Helper.tla"
install_registry valid.txt
if orphan_output=$(run_check 2>&1); then
  fail "an unregistered .tla model was accepted."
else
  orphan_status=$?
fi
[ "$orphan_status" -eq 1 ] ||
  fail "an unregistered model exited $orphan_status instead of 1."
assert_contains "$orphan_output" "formal/helper/Helper.tla is not registered"
[ ! -e "$JAVA_LOG" ] ||
  fail "an unregistered model launched Java before validation finished."
rm -rf "$TEST_ROOT/formal/helper"

assert_validation_failure empty.txt "does not register any models"
assert_validation_failure malformed.txt "contains whitespace"
assert_validation_failure duplicate.txt "more than once"
assert_validation_failure duplicateConfig.txt "assigns formal/alpha/Alpha.cfg to more than one model"
assert_validation_failure extraDelimiter.txt "must contain exactly one '|'"
assert_validation_failure missingConfig.txt "does not exist"
assert_validation_failure missingModel.txt "does not exist"
assert_validation_failure traversal.txt "contains a non-normalized path"
assert_validation_failure unregistered.txt "Zeta.cfg is not registered"

echo "Protocol model registry regression fixtures passed."
