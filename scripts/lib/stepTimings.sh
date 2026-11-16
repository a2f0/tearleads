# shellcheck shell=sh
# Shared step timings for long multi-step scripts — the deploy and release
# wrappers and check:fast. Not executable on its own: source it, wrap each
# step, then print the summary.
#
#   . "$REPO_ROOT/scripts/lib/stepTimings.sh"
#   step_timings_reset
#   step_timings_run typescript bun tsc --build
#   step_timings_summary
#
# Timed rows accumulate in step_timings_rows as "<label><tab><seconds>" lines so
# the summary can size its label column from the longest label.
# POSIX sh throughout: its callers run under /bin/sh, so `local`, arrays, and
# bash's SECONDS are all unavailable here.

step_timings_tab=$(printf '\t')
step_timings_newline='
'
step_timings_rows=""
step_timings_started=0
step_timings_step_started=0
# Set while a step is in flight, so a run that dies mid-step can report which
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
