# shellcheck shell=sh
# Shared step timings for long multi-step scripts — the deploy wrappers and the
# pre-push gate. Not executable on its own: source it, wrap each step, then
# print the summary.
#
#   . "$REPO_ROOT/scripts/stepTimings.sh"
#   step_timings_reset
#   step_timings_run typescript bun tsc --build
#   step_timings_summary
#
# Timed rows accumulate in step_timings_rows as "<label><tab><seconds>" lines so
# the summary can size its label column from the longest label, and so a caller
# such as the pre-push hook can persist the same rows for a later reader.
# POSIX sh throughout: the hooks run under /bin/sh, so `local`, arrays, and
# bash's SECONDS are all unavailable here.

step_timings_tab=$(printf '\t')
step_timings_newline='
'
step_timings_rows=""
step_timings_started=0
step_timings_step_started=0
# Set while a step is in flight, so a run that dies mid-step still records which
# step it died in.
step_timings_open_label=""

step_timings_now() {
  date +%s
}

step_timings_reset() {
  step_timings_rows=""
  step_timings_open_label=""
  step_timings_started=$(step_timings_now)
}

step_timings_record() {
  step_timings_rows="${step_timings_rows}${1}${step_timings_tab}${2}${step_timings_newline}"
}

step_timings_begin() {
  step_timings_open_label=$1
  shift
  if [ "$#" -gt 0 ]; then
    echo "--- [$step_timings_open_label] $* ---"
  else
    echo "--- [$step_timings_open_label] ---"
  fi
  step_timings_step_started=$(step_timings_now)
}

step_timings_end() {
  step_timings_elapsed=$(($(step_timings_now) - step_timings_step_started))
  step_timings_record "$step_timings_open_label" "$step_timings_elapsed"
  echo "[$step_timings_open_label] done in $(step_timings_duration "$step_timings_elapsed")."
  echo ""
  step_timings_open_label=""
}

step_timings_run() {
  step_timings_label=$1
  shift
  step_timings_begin "$step_timings_label" "$@"
  "$@"
  step_timings_end
}

step_timings_skip() {
  step_timings_label=$1
  shift
  if [ "$#" -gt 0 ]; then
    echo "--- [$step_timings_label] skipped ($*) ---"
  else
    echo "--- [$step_timings_label] skipped ---"
  fi
  step_timings_record "$step_timings_label" skipped
  echo ""
}

step_timings_duration() {
  case "$1" in
    '' | *[!0-9]*) printf '%s\n' "$1" ;;
    *) printf '%dm%02ds\n' "$(($1 / 60))" "$(($1 % 60))" ;;
  esac
}

# Renders "<label><tab><value>" rows read from stdin as an aligned table. A row
# labelled "total" is preceded by a rule; non-numeric values ("skipped") pass
# through as written.
step_timings_render_table() {
  awk -F'\t' '
    function duration(value) {
      if (value ~ /^[0-9]+$/) {
        return sprintf("%dm%02ds", value / 60, value % 60)
      }
      return value
    }
    NF < 2 { next }
    {
      count++
      labels[count] = $1
      values[count] = $2
      if (length($1) > width) {
        width = length($1)
      }
    }
    END {
      if (count == 0) {
        exit
      }
      rule = ""
      for (index_ = 0; index_ < width + 7; index_++) {
        rule = rule "-"
      }
      print "--- Timing summary ---"
      for (index_ = 1; index_ <= count; index_++) {
        if (labels[index_] == "total") {
          print "  " rule
        }
        printf "  %-*s %s\n", width, labels[index_], duration(values[index_])
      }
    }
  '
}

step_timings_summary() {
  {
    printf '%s' "$step_timings_rows"
    printf 'total\t%s\n' "$(($(step_timings_now) - step_timings_started))"
  } | step_timings_render_table
}

# Appends this run to a tab-separated log: one "run" line carrying the run's
# metadata, then one "step" line per timed step. Extra "key=value" fields are
# appended to the run line verbatim. Bookkeeping never fails its caller — a
# script's real work matters more than its timings — so every step returns 0.
step_timings_append_log() {
  step_timings_log_file=$1
  shift
  step_timings_log_dir=${step_timings_log_file%/*}
  if [ "$step_timings_log_dir" != "$step_timings_log_file" ]; then
    mkdir -p "$step_timings_log_dir" || return 0
  fi
  {
    printf 'run\tat=%s\ttotal=%s' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      "$(($(step_timings_now) - step_timings_started))"
    if [ -n "$step_timings_open_label" ]; then
      printf '\tunfinished=%s' "$step_timings_open_label"
    fi
    for step_timings_field in "$@"; do
      printf '\t%s' "$step_timings_field"
    done
    printf '\n'
    printf '%s' "$step_timings_rows" |
      awk -F'\t' -v OFS='\t' 'NF >= 2 { print "step", $1, $2 }'
  } >>"$step_timings_log_file" || return 0
  step_timings_trim_log "$step_timings_log_file" "${STEP_TIMINGS_LOG_RUNS:-20}"
}

step_timings_trim_log() {
  step_timings_trim_skip=$(
    awk -F'\t' -v keep="$2" '
      $1 == "run" { runs++ }
      END { print (runs > keep ? runs - keep : 0) }
    ' "$1"
  ) || return 0
  [ "$step_timings_trim_skip" -gt 0 ] || return 0
  step_timings_trim_tmp="$1.$$"
  awk -F'\t' -v skip="$step_timings_trim_skip" '
    $1 == "run" { seen++ }
    seen > skip
  ' "$1" >"$step_timings_trim_tmp" || {
    rm -f "$step_timings_trim_tmp"
    return 0
  }
  mv "$step_timings_trim_tmp" "$1" || rm -f "$step_timings_trim_tmp"
  return 0
}
