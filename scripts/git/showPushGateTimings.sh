#!/bin/sh
# Prints the step timings the pre-push hook recorded for a push-gate run.
#
# The hook appends every run to a log inside the git directory, so the timings
# outlive the push itself: a flow such as the `ship-pr` skill can report what
# the gate cost long after the PR merged, and a slow push can be dissected
# without re-running it.

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../stepTimings.sh
# shellcheck disable=SC1091
. "$REPO_ROOT/scripts/stepTimings.sh"

HEAD_SHA=""
LOG_FILE=""
PRINT_LOG_PATH=false

usage() {
  cat <<EOF
Usage: $(basename "$0") [--head <sha>] [--log <path>] [--log-path]

Options:
  --head <sha>  Show the run that pushed this commit instead of the last run.
  --log <path>  Read a specific log file.
  --log-path    Print the default log path and exit.
  -h, --help    Show this help and exit.

Environment:
  PUSH_GATE_TIMINGS_LOG  Overrides the default log path. The pre-push hook asks
                         this script where to write, so setting it redirects the
                         recording too — which is how the hook is tested.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --head)
      [ "$#" -ge 2 ] || {
        echo "Error: --head requires a commit sha" >&2
        exit 1
      }
      HEAD_SHA="$2"
      shift 2
      ;;
    --log)
      [ "$#" -ge 2 ] || {
        echo "Error: --log requires a path" >&2
        exit 1
      }
      LOG_FILE="$2"
      shift 2
      ;;
    --log-path)
      PRINT_LOG_PATH=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

# Inside the git directory rather than the worktree: the log is per-checkout
# scratch, it must never be committable, and a linked worktree keeps its own.
if [ -z "$LOG_FILE" ]; then
  LOG_FILE="${PUSH_GATE_TIMINGS_LOG:-$(git rev-parse --absolute-git-dir)/tearleads/pushGateTimings.tsv}"
fi

if [ "$PRINT_LOG_PATH" = true ]; then
  printf '%s\n' "$LOG_FILE"
  exit 0
fi

if [ ! -f "$LOG_FILE" ]; then
  echo "No push-gate timings recorded yet ($LOG_FILE)."
  exit 0
fi

# Runs are appended in order, so the last matching one is the newest.
RUN_BLOCK="$(
  awk -F'\t' -v head="$HEAD_SHA" '
    $1 == "run" {
      matched = (head == "" || index($0, "\thead=" head) > 0)
      if (matched) {
        count++
        block[count] = $0
      }
      next
    }
    matched && count > 0 { block[count] = block[count] "\n" $0 }
    END { if (count > 0) { print block[count] } }
  ' "$LOG_FILE"
)"

if [ -z "$RUN_BLOCK" ]; then
  if [ -n "$HEAD_SHA" ]; then
    echo "No push-gate run recorded for $HEAD_SHA."
  else
    echo "No push-gate run recorded in $LOG_FILE."
  fi
  exit 0
fi

# Prints the run line's values for a key: one per line, since a push that
# carried several refs records one head= field per commit.
run_field() {
  printf '%s\n' "$RUN_BLOCK" |
    awk -F'\t' -v key="$1" '
      NR > 1 { exit }
      {
        for (field = 2; field <= NF; field++) {
          if (index($field, key "=") == 1) {
            print substr($field, length(key) + 2)
          }
        }
      }
    '
}

printf 'Push gate: %s at %s (%s)\n' \
  "$(run_field branch)" "$(run_field at)" "$(run_field status)"
printf '  pushed %s to %s\n' \
  "$(run_field head | paste -sd, - | sed 's/,/, /g')" "$(run_field remote)"
UNFINISHED="$(run_field unfinished)"
if [ -n "$UNFINISHED" ]; then
  printf '  stopped during %s\n' "$UNFINISHED"
fi

{
  printf '%s\n' "$RUN_BLOCK" |
    awk -F'\t' -v OFS='\t' '$1 == "step" { print $2, $3 }'
  printf 'total\t%s\n' "$(run_field total)"
} | step_timings_render_table
