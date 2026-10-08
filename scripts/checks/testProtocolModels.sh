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

# The assertions below pick their own parallelism and failure-log directory;
# values exported by the caller must not change them.
unset PROTOCOL_TLC_PARALLELISM PROTOCOL_TLC_FAILURE_LOG_DIR

SOURCE_ROOT=$(git rev-parse --show-toplevel)
CHECK_SCRIPT=$SOURCE_ROOT/scripts/checks/checkProtocolModels.sh
FIXTURE_ROOT=$SOURCE_ROOT/scripts/checks/fixtures/protocolModels

# Hooks export the caller's repository metadata. Fixture initialization must
# target its own repository, including when this script runs in a linked worktree.
for git_local_env in $(git rev-parse --local-env-vars); do
  unset "$git_local_env"
done

TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/protocol-models.XXXXXX")
JAVA_LOG=$TEST_ROOT/java.log

# An interrupted run of this test must not strand the hung check it starts.
interrupted_check=
trap '[ -z "$interrupted_check" ] || kill -TERM "$interrupted_check" 2>/dev/null; rm -rf "$TEST_ROOT"' EXIT
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

mkdir -p "$TEST_ROOT/tmp"

# The check's own temp root, and any failure log it keeps, stay under TEST_ROOT.
run_check() (
  cd "$TEST_ROOT"
  TMPDIR="$TEST_ROOT/tmp" \
    PATH="$TEST_ROOT/bin:$PATH" \
    FAKE_JAVA="$TEST_ROOT/bin/java" \
    FAKE_JAVA_LOG="$JAVA_LOG" \
    FAKE_TLA_TOOLS_ROOT="$TEST_ROOT/tla-tools" \
    JAVA_BIN="$TEST_ROOT/bin/java" \
    TLA_TOOLS_ROOT="$TEST_ROOT/tla-tools" \
    FAKE_FAIL_CONFIG="${FAKE_FAIL_CONFIG:-}" \
    FAKE_FAIL_MODEL="${FAKE_FAIL_MODEL:-}" \
    FAKE_FAIL_STATUS="${FAKE_FAIL_STATUS:-}" \
    PROTOCOL_TLC_FAILURE_LOG_DIR="${PROTOCOL_TLC_FAILURE_LOG_DIR:-}" \
    PROTOCOL_TLC_PARALLELISM="${PROTOCOL_TLC_PARALLELISM:-}" \
    TLA_TOOLS_JAR_SHA256="${TLA_TOOLS_JAR_SHA256:-$FIXTURE_JAR_SHA256}" \
    "$CHECK_SCRIPT"
)

run_check_with_mise() (
  cd "$TEST_ROOT"
  unset JAVA_BIN TLA_TOOLS_ROOT
  TMPDIR="$TEST_ROOT/tmp" \
    PATH="$TEST_ROOT/bin:$PATH" \
    FAKE_JAVA="$TEST_ROOT/bin/java" \
    FAKE_JAVA_LOG="$JAVA_LOG" \
    FAKE_TLA_TOOLS_ROOT="$TEST_ROOT/tla-tools" \
    TLA_TOOLS_JAR_SHA256="$FIXTURE_JAR_SHA256" \
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
mise_output=$(run_check_with_mise)
assert_contains "$mise_output" "Checked 3 protocol model configuration(s)."

install_registry valid.txt
valid_output=$(run_check)
assert_contains "$valid_output" "Checked 3 protocol model configuration(s)."
# A pass reports TLC's verdict and summary, never its whole log.
assert_contains "$valid_output" "The depth of the complete state graph search is 2."
assert_contains "$valid_output" "3 distinct states found"
case "$valid_output" in
  *"fake-tlc trace line"*) fail "a passing model replayed its whole log." ;;
esac

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

# CI's stdout can be non-blocking, so a report write may fail. That must never
# abort the check: a pass still exits 0 and a failure keeps TLC's status.
install_registry valid.txt
run_check >&- 2>/dev/null ||
  fail "an unwritable stdout aborted a passing check."
install_registry valid.txt
# A subshell keeps the assignments from outliving the function call, which
# POSIX shells (macOS /bin/sh among them) otherwise allow.
if (FAKE_FAIL_CONFIG=formal/alpha/AlphaBroad.cfg FAKE_FAIL_STATUS=17 \
  run_check >&- 2>/dev/null); then
  fail "a TLC failure was accepted with an unwritable stdout."
else
  closed_status=$?
fi
[ "$closed_status" -eq 17 ] ||
  fail "TLC exit 17 was reported as $closed_status with an unwritable stdout."

# One run at a time, a failure must stop the check before the next run starts.
# With overlapping runs, which later runs had already started depends on
# timing, so only the reported failure is asserted there.
# The second run keeps its log where CI asks, in a directory not created yet.
for parallelism in 1 2; do
  install_registry valid.txt
  failure_log_dir=
  [ "$parallelism" -eq 1 ] || failure_log_dir=$TEST_ROOT/failure-logs/nested
  if failure_output=$(
    FAKE_FAIL_CONFIG=formal/alpha/AlphaBroad.cfg \
      FAKE_FAIL_STATUS=17 \
      PROTOCOL_TLC_FAILURE_LOG_DIR=$failure_log_dir \
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
  # A failure replays its whole log: the counterexample is the evidence.
  assert_contains "$failure_output" "fake-tlc trace line for formal/alpha/AlphaBroad.cfg"
  # The log also outlives the check, since its temp root is removed on exit.
  kept_log=$(printf '%s\n' "$failure_output" | sed -n 's/^Full TLC log kept at \(.*\)\.$/\1/p')
  if [ -z "$kept_log" ] ||
    ! grep -q "fake-tlc trace line for formal/alpha/AlphaBroad.cfg" "$kept_log"; then
    fail "a failing TLC log was not kept at parallelism $parallelism."
  fi
  case "$kept_log" in
    "${failure_log_dir:-$TEST_ROOT/tmp}"/*) ;;
    *) fail "a failing TLC log was kept outside its directory: $kept_log" ;;
  esac
  rm -f "$kept_log"
  if [ "$parallelism" -eq 1 ]; then
    [ "$(wc -l <"$JAVA_LOG" | tr -d '[:space:]')" -eq 2 ] ||
      fail "the checker did not stop after the first TLC failure."
  fi
done

# An interrupted check must stop its in-flight runs. They are background jobs
# that Ctrl-C does not reach, so only the check's own trap can end them; TERM
# exercises that trap without depending on how the caller's shell handles INT.
install_registry valid.txt
(
  cd "$TEST_ROOT"
  exec env PATH="$TEST_ROOT/bin:$PATH" \
    FAKE_JAVA="$TEST_ROOT/bin/java" \
    FAKE_JAVA_LOG="$JAVA_LOG" \
    FAKE_JAVA_HANG=1 \
    FAKE_TLA_TOOLS_ROOT="$TEST_ROOT/tla-tools" \
    JAVA_BIN="$TEST_ROOT/bin/java" \
    TLA_TOOLS_ROOT="$TEST_ROOT/tla-tools" \
    TLA_TOOLS_JAR_SHA256="$FIXTURE_JAR_SHA256" \
    "$CHECK_SCRIPT"
) >/dev/null 2>&1 &
interrupted_check=$!
hang_wait=0
until [ "$(wc -l 2>/dev/null <"$JAVA_LOG" | tr -d '[:space:]')" = 2 ]; do
  hang_wait=$((hang_wait + 1))
  if [ "$hang_wait" -gt 30 ]; then
    kill -TERM "$interrupted_check" 2>/dev/null || :
    fail "the interrupted check never started both runs."
  fi
  sleep 1
done
# Both runs have logged; give each a moment to record its PID.
sleep 1
kill -TERM "$interrupted_check"
wait "$interrupted_check" || :
interrupted_check=
cut -d '|' -f 5 "$JAVA_LOG" >"$TEST_ROOT/run-pids"
# A killed run is reaped by its own job shortly after the check exits, and
# kill -0 still succeeds on it until then, so allow a few seconds to settle.
settle_wait=0
while :; do
  surviving_runs=
  while read -r run_pid; do
    if kill -0 "$run_pid" 2>/dev/null; then
      surviving_runs="$surviving_runs $run_pid"
    fi
  done <"$TEST_ROOT/run-pids"
  [ -n "$surviving_runs" ] || break
  settle_wait=$((settle_wait + 1))
  if [ "$settle_wait" -gt 5 ]; then
    for run_pid in $surviving_runs; do
      kill "$run_pid" 2>/dev/null || :
    done
    fail "an interrupted check left TLC runs running:$surviving_runs."
  fi
  sleep 1
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
