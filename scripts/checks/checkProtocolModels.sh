#!/usr/bin/env sh

set -eu

fail() {
  echo "Error: $*" >&2
  exit 1
}

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd) ||
  fail "could not resolve the protocol check script directory."

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) ||
  fail "Protocol model checks must run inside a Git repository."
REGISTRY_PATH=formal/protocol-models.txt

cd "$REPO_ROOT"

[ -f "$REGISTRY_PATH" ] || fail "$REGISTRY_PATH does not exist."

CHECK_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/tearleads-tlc.XXXXXX")
trap 'rm -rf "$CHECK_ROOT"' EXIT

# Overlapping TLC runs are background jobs, which a non-interactive shell starts
# with SIGINT ignored, and a JVM keeps a signal ignored when it starts that way,
# so Ctrl-C reaches none of them. Each in-flight run leaves its Java PID in a
# file; an interrupted check stops those runs before its state is removed.
stop_runs() {
  for run_pid_file in "$CHECK_ROOT"/model-*.pid; do
    [ -f "$run_pid_file" ] || continue
    kill "$(cat "$run_pid_file")" 2>/dev/null || :
  done
}
# Waiting lets the stopped runs exit before the EXIT trap removes their state.
trap 'stop_runs; wait; exit 1' HUP INT TERM

REGISTERED_MODELS=$CHECK_ROOT/registered-models.txt
SORTED_MODELS=$CHECK_ROOT/sorted-models.txt
RAW_REGISTERED_CONFIGS=$CHECK_ROOT/raw-registered-configs.txt
REGISTERED_CONFIGS=$CHECK_ROOT/registered-configs.txt
DISCOVERED_CONFIGS_UNSORTED=$CHECK_ROOT/discovered-configs-unsorted.txt
DISCOVERED_CONFIGS=$CHECK_ROOT/discovered-configs.txt
DUPLICATE_PAIRS=$CHECK_ROOT/duplicate-pairs.txt
DUPLICATE_CONFIGS=$CHECK_ROOT/duplicate-configs.txt
UNREGISTERED_CONFIGS=$CHECK_ROOT/unregistered-configs.txt
RAW_REGISTERED_MODEL_PATHS=$CHECK_ROOT/raw-registered-model-paths.txt
REGISTERED_MODEL_PATHS=$CHECK_ROOT/registered-model-paths.txt
DISCOVERED_MODELS_UNSORTED=$CHECK_ROOT/discovered-models-unsorted.txt
DISCOVERED_MODELS=$CHECK_ROOT/discovered-models.txt
UNREGISTERED_MODELS=$CHECK_ROOT/unregistered-models.txt

line_number=0
while IFS= read -r registry_line || [ -n "$registry_line" ]; do
  line_number=$((line_number + 1))

  case "$registry_line" in
    ''|'#'*) continue ;;
  esac

  case "$registry_line" in
    *[[:space:]]*)
      fail "$REGISTRY_PATH:$line_number contains whitespace; use model|config."
      ;;
  esac

  model_path=${registry_line%%|*}
  config_path=${registry_line#*|}
  [ "$config_path" != "$registry_line" ] ||
    fail "$REGISTRY_PATH:$line_number must contain one model|config pair."
  case "$config_path" in
    *'|'*)
      fail "$REGISTRY_PATH:$line_number must contain exactly one '|'."
      ;;
  esac

  case "$model_path" in
    formal/*.tla) ;;
    *) fail "$REGISTRY_PATH:$line_number model must be a .tla path under formal/." ;;
  esac
  case "$config_path" in
    formal/*.cfg) ;;
    *) fail "$REGISTRY_PATH:$line_number config must be a .cfg path under formal/." ;;
  esac

  case "/$model_path/$config_path/" in
    *'/../'*|*'/./'*|*'//'*)
      fail "$REGISTRY_PATH:$line_number contains a non-normalized path."
      ;;
  esac
  case "$model_path$config_path" in
    *\\*) fail "$REGISTRY_PATH:$line_number must use forward slashes." ;;
  esac

  [ ! -L "$model_path" ] || fail "$model_path must not be a symbolic link."
  [ ! -L "$config_path" ] || fail "$config_path must not be a symbolic link."
  [ -f "$model_path" ] || fail "$model_path does not exist."
  [ -f "$config_path" ] || fail "$config_path does not exist."
  printf '%s|%s\n' "$model_path" "$config_path" >>"$REGISTERED_MODELS"
done <"$REGISTRY_PATH"

[ -s "$REGISTERED_MODELS" ] || fail "$REGISTRY_PATH does not register any models."

LC_ALL=C sort "$REGISTERED_MODELS" >"$SORTED_MODELS" ||
  fail "could not sort $REGISTRY_PATH."
uniq -d "$SORTED_MODELS" >"$DUPLICATE_PAIRS" ||
  fail "could not inspect $REGISTRY_PATH for duplicate pairs."
duplicate_pair=$(sed -n '1p' "$DUPLICATE_PAIRS")
[ -z "$duplicate_pair" ] || fail "$REGISTRY_PATH registers $duplicate_pair more than once."

cut -d '|' -f 2 "$REGISTERED_MODELS" >"$RAW_REGISTERED_CONFIGS" ||
  fail "could not read configuration paths from $REGISTRY_PATH."
LC_ALL=C sort "$RAW_REGISTERED_CONFIGS" >"$REGISTERED_CONFIGS" ||
  fail "could not sort registered configuration paths."
uniq -d "$REGISTERED_CONFIGS" >"$DUPLICATE_CONFIGS" ||
  fail "could not inspect $REGISTRY_PATH for duplicate configurations."
duplicate_config=$(sed -n '1p' "$DUPLICATE_CONFIGS")
[ -z "$duplicate_config" ] ||
  fail "$REGISTRY_PATH assigns $duplicate_config to more than one model."

find formal -type f -name '*.cfg' -print >"$DISCOVERED_CONFIGS_UNSORTED" ||
  fail "could not discover protocol model configurations under formal/."
LC_ALL=C sort "$DISCOVERED_CONFIGS_UNSORTED" >"$DISCOVERED_CONFIGS" ||
  fail "could not sort discovered protocol model configurations."
LC_ALL=C comm -23 "$DISCOVERED_CONFIGS" "$REGISTERED_CONFIGS" >"$UNREGISTERED_CONFIGS" ||
  fail "could not compare discovered and registered protocol model configurations."
unregistered_config=$(sed -n '1p' "$UNREGISTERED_CONFIGS")
[ -z "$unregistered_config" ] ||
  fail "$unregistered_config is not registered in $REGISTRY_PATH."

# Reconcile .tla files too: with only the .cfg reconciliation above, deleting
# a model's configuration (and its registry row) leaves the model on disk but
# silently removes it from checking.
cut -d '|' -f 1 "$REGISTERED_MODELS" >"$RAW_REGISTERED_MODEL_PATHS" ||
  fail "could not read model paths from $REGISTRY_PATH."
LC_ALL=C sort -u "$RAW_REGISTERED_MODEL_PATHS" >"$REGISTERED_MODEL_PATHS" ||
  fail "could not sort registered model paths."
find formal -type f -name '*.tla' -print >"$DISCOVERED_MODELS_UNSORTED" ||
  fail "could not discover protocol models under formal/."
LC_ALL=C sort "$DISCOVERED_MODELS_UNSORTED" >"$DISCOVERED_MODELS" ||
  fail "could not sort discovered protocol models."
LC_ALL=C comm -23 "$DISCOVERED_MODELS" "$REGISTERED_MODEL_PATHS" >"$UNREGISTERED_MODELS" ||
  fail "could not compare discovered and registered protocol models."
unregistered_model=$(sed -n '1p' "$UNREGISTERED_MODELS")
[ -z "$unregistered_model" ] ||
  fail "$unregistered_model is not registered in $REGISTRY_PATH; an unregistered model is never checked."

mv "$SORTED_MODELS" "$REGISTERED_MODELS" ||
  fail "could not finalize the protocol model registry."

TLC_PARALLELISM=${PROTOCOL_TLC_PARALLELISM:-2}
case "$TLC_PARALLELISM" in
  *[!0-9]*) fail "PROTOCOL_TLC_PARALLELISM must be a positive integer." ;;
esac
[ "$TLC_PARALLELISM" -ge 1 ] ||
  fail "PROTOCOL_TLC_PARALLELISM must be a positive integer."

if [ -z "${JAVA_BIN:-}" ] || [ -z "${TLA_TOOLS_ROOT:-}" ]; then
  command -v mise >/dev/null 2>&1 ||
    fail "mise is unavailable. Install mise, then run 'mise install github:tlaplus/tlaplus'."
fi

if [ -z "${JAVA_BIN:-}" ]; then
  JAVA_BIN=$(mise which java 2>/dev/null) ||
    fail "Java is unavailable. Run 'mise install java'."
fi
[ -x "$JAVA_BIN" ] || fail "$JAVA_BIN is not executable."
java_pin=$(sed -n 's/^java = "temurin-\([^+]*\)+.*"$/\1/p' "$SCRIPT_DIR/../../.mise.toml")
[ -n "$java_pin" ] || fail "could not read the Java pin from .mise.toml."
java_version=$("$JAVA_BIN" -version 2>&1) ||
  fail "$JAVA_BIN could not report its version."
case "$java_version" in
  *"version \"$java_pin\""*|*"version \"$java_pin."*) ;;
  *) fail "$JAVA_BIN does not report the pinned Java $java_pin version." ;;
esac

if [ -z "${TLA_TOOLS_ROOT:-}" ]; then
  TLA_TOOLS_ROOT=$(mise where github:tlaplus/tlaplus 2>/dev/null) ||
    fail "TLA+ tools are unavailable. Run 'mise install github:tlaplus/tlaplus'."
fi
TLA_TOOLS_JAR=$TLA_TOOLS_ROOT/tla2tools.jar
[ -f "$TLA_TOOLS_JAR" ] || fail "$TLA_TOOLS_JAR does not exist."

# The pinned jar digest is shared with the protocol trace generator; see
# scripts/checks/tlaToolsPin.sh. Update the pin only for an intentional TLA+
# tools upgrade.
# shellcheck source=scripts/checks/tlaToolsPin.sh
. "$SCRIPT_DIR/tlaToolsPin.sh"
TLA_TOOLS_JAR_SHA256=${TLA_TOOLS_JAR_SHA256:-$TLA_TOOLS_JAR_SHA256_PIN}
if command -v sha256sum >/dev/null 2>&1; then
  tla_tools_jar_sha256=$(sha256sum "$TLA_TOOLS_JAR" | cut -d ' ' -f 1)
else
  tla_tools_jar_sha256=$(shasum -a 256 "$TLA_TOOLS_JAR" | cut -d ' ' -f 1)
fi
[ "$tla_tools_jar_sha256" = "$TLA_TOOLS_JAR_SHA256" ] ||
  fail "$TLA_TOOLS_JAR sha256 $tla_tools_jar_sha256 does not match the pinned $TLA_TOOLS_JAR_SHA256."

# Two isolations keep overlapping runs independent:
#
# - SANY copies every standard module it resolves out of the jar to
#   ${java.io.tmpdir}/<Module>.tla, truncating the file on write and deleting
#   it on exit. Runs that share a tmpdir — two in this pool, or two checkouts
#   pushing at once — truncate each other's copy mid-parse and fail with a
#   spurious SANY error, so each run gets a private tmpdir.
# - TLC resolves the machine's hostname while sizing its fingerprint set and
#   again on close. Where that name is not in /etc/hosts (a macOS *.local name
#   goes to mDNS), two JVMs resolving it at the same instant stall one of them
#   for the resolver's 5s timeout. A hosts file mapping the name to loopback
#   keeps the system resolver out of every run.
TLC_HOSTS_FILE=$CHECK_ROOT/hosts
printf '127.0.0.1 %s localhost\n' "$(hostname)" >"$TLC_HOSTS_FILE"

run_model() {
  run_state_path=$CHECK_ROOT/model-$1
  mkdir "$run_state_path" "$run_state_path/java-tmp"
  "$JAVA_BIN" -XX:+UseParallelGC \
    "-Djava.io.tmpdir=$run_state_path/java-tmp" \
    "-Djdk.net.hosts.file=$TLC_HOSTS_FILE" \
    -jar "$TLA_TOOLS_JAR" \
    -workers 1 \
    -metadir "$run_state_path" \
    -config "$3" \
    "$2" >"$run_state_path.log" 2>&1 </dev/null &
  # A signal landing between this fork and the PID write finds no file, so that
  # one run can outlive an interrupted check; the window is a few instructions.
  echo "$!" >"$run_state_path.pid"
  if wait "$!"; then
    run_status=0
  else
    run_status=$?
  fi
  # A finished run's PID may be reused, so it must never be signalled.
  rm -f "$run_state_path.pid"
  echo "$run_status" >"$run_state_path.status"
}

# Up to $TLC_PARALLELISM runs overlap. A finished run posts its index to a FIFO,
# which frees its slot. Output is replayed in registry order once every earlier
# run has finished, so the log reads the same at any parallelism. After a
# failure no new run starts and the in-flight ones finish; the first failure in
# registry order sets the exit status.
DONE_FIFO=$CHECK_ROOT/done
mkfifo "$DONE_FIFO"
exec 3<>"$DONE_FIFO"

model_count=0
running=0
next_report=1
failed_index=
stop_launching=

# Reporting is best effort: CI's stdout can be non-blocking, and a failed write
# must neither abort the check nor change its verdict. Lines go through an
# external cat because a failed builtin write leaves its text buffered in this
# shell, where the next command substitution picks it up, corrupting the status
# it reads.
report_line() {
  printf '%s\n' "$*" | cat || :
}

# A run's recorded exit status; anything but a plain number counts as a failure.
read_run_status() {
  run_status_value=$(cat "$1" 2>/dev/null) || run_status_value=1
  case $run_status_value in
    '' | *[!0-9]*) run_status_value=1 ;;
  esac
}

# A failing log outlives the check: a long counterexample can be cut short on
# a non-blocking CI stdout, and the EXIT trap removes everything under
# CHECK_ROOT. CI points PROTOCOL_TLC_FAILURE_LOG_DIR at a directory it uploads;
# locally the log stays in TMPDIR. Keeping it is best effort, like the report.
keep_failure_log() {
  failure_log_dir=${PROTOCOL_TLC_FAILURE_LOG_DIR:-${TMPDIR:-/tmp}}
  mkdir -p "$failure_log_dir" 2>/dev/null || return 0
  kept_log=$(mktemp "$failure_log_dir/tearleads-tlc-failure.XXXXXX") || return 0
  if cp "$1" "$kept_log" 2>/dev/null; then
    report_line "Full TLC log kept at $kept_log." >&2
  else
    rm -f "$kept_log"
  fi
}

report_finished_runs() {
  while [ -z "$failed_index" ] && [ -e "$CHECK_ROOT/model-$next_report.done" ]; do
    report_path=$CHECK_ROOT/model-$next_report
    report_line "Checking $(cat "$report_path.label")..."
    read_run_status "$report_path.status"
    report_status=$run_status_value
    if [ "$report_status" -ne 0 ]; then
      # A failure replays its whole log; the counterexample is the evidence.
      cat "$report_path.log" 2>/dev/null || :
      keep_failure_log "$report_path.log"
      failed_index=$next_report
      failed_status=$report_status
    else
      # A pass prints only TLC's verdict, warnings and summary. Replaying every
      # log, thousands of trace lines for the trace-export model, overran a
      # non-blocking CI stdout and aborted the check with no model at fault.
      grep -E '^Warning|No error has been found|distinct states found|depth of the complete state graph|Finished in' \
        "$report_path.log" 2>/dev/null || :
      next_report=$((next_report + 1))
    fi
  done
}

await_run() {
  read -r finished_index <&3
  running=$((running - 1))
  : >"$CHECK_ROOT/model-$finished_index.done"
  read_run_status "$CHECK_ROOT/model-$finished_index.status"
  [ "$run_status_value" -eq 0 ] || stop_launching=1
  report_finished_runs
}

while IFS='|' read -r model_path config_path; do
  while [ "$running" -ge "$TLC_PARALLELISM" ] && [ -z "$stop_launching" ]; do
    await_run
  done
  [ -z "$stop_launching" ] || break
  model_count=$((model_count + 1))
  running=$((running + 1))
  printf '%s with %s' "$model_path" "$config_path" \
    >"$CHECK_ROOT/model-$model_count.label"
  # The post runs even if run_model dies, so the pool can never wait forever.
  # stdin is the registry this loop is reading, so the job must not inherit it.
  {
    (run_model "$model_count" "$model_path" "$config_path") || :
    echo "$model_count" >&3
  } </dev/null &
done <"$REGISTERED_MODELS"
while [ "$running" -gt 0 ]; do
  await_run
done
exec 3>&-

if [ -n "$failed_index" ]; then
  report_line "Error: TLC failed for $(cat "$CHECK_ROOT/model-$failed_index.label")." >&2
  exit "$failed_status"
fi

report_line "Checked $model_count protocol model configuration(s)."
