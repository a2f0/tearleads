#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE' >&2
Usage: ./scripts/checks/preen/checkPreenEcosystem.sh [--strict|--summary|--count-issues]

Modes:
  --strict       Print findings and exit non-zero on issues (default)
  --summary      Print findings but always exit zero
  --count-issues Print issue count only and exit zero
USAGE
  exit 2
}

MODE="strict"
if [ "$#" -gt 1 ]; then
  usage
fi
if [ "$#" -eq 1 ]; then
  case "$1" in
    --strict)
      MODE="strict"
      ;;
    --summary)
      MODE="summary"
      ;;
    --count-issues)
      MODE="count"
      ;;
    *)
      usage
      ;;
  esac
fi

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

mapfile -t COMMAND_NAMES < <(find .claude/skills -mindepth 1 -maxdepth 1 -type d -print | sed 's#.*/##' | sort)

if [ "${#COMMAND_NAMES[@]}" -eq 0 ]; then
  echo "Error: no command names found under .claude/skills" >&2
  exit 1
fi

ISSUES=0
NORMALIZE_CACHE_DIR="$(mktemp -d)"
trap 'rm -rf "$NORMALIZE_CACHE_DIR"' EXIT

escape_ere() {
  printf '%s' "$1" | sed -E 's/[][(){}.^$*+?|\\]/\\&/g'
}

join_with_pipe() {
  local output="$1"
  shift

  local item
  for item in "$@"; do
    if [ -z "$output" ]; then
      output="$item"
    else
      output="${output}|${item}"
    fi
  done

  printf '%s' "$output"
}

mapfile -t ESCAPED_COMMAND_NAMES < <(
  for command_name in "${COMMAND_NAMES[@]}"; do
    escape_ere "$command_name"
    echo
  done
)
COMMAND_ALT="$(join_with_pipe "" "${ESCAPED_COMMAND_NAMES[@]}")"

report_issue() {
  ISSUES=$((ISSUES + 1))
  if [ "$MODE" != "count" ]; then
    echo "[preen-check] $1" >&2
  fi
}

get_normalized_file() {
  local source_file="$1"
  local cache_key
  local normalized_file

  cache_key="$(printf '%s' "$source_file" | shasum | awk '{print $1}')"
  normalized_file="${NORMALIZE_CACHE_DIR}/${cache_key}.normalized"

  if [ ! -f "$normalized_file" ]; then
    awk '
      NR == 1 && $0 == "---" { in_frontmatter = 1; next }
      in_frontmatter && $0 == "---" { in_frontmatter = 0; next }
      in_frontmatter { next }
      { print }
    ' "$source_file" \
      | perl -pe "
        s{(^|[^[:alnum:]_.-])/(${COMMAND_ALT})(?=[^[:alnum:]-]|\\\$)}{\$1<cmd:\$2>}g;
        s{(^|[^[:alnum:]_.-])\\\$(${COMMAND_ALT})(?=[^[:alnum:]-]|\\\$)}{\$1<cmd:\$2>}g;
      " \
      | sed -E 's/[[:space:]]+$//' \
      | sed -E '/./,$!d' > "$normalized_file"
  fi

  printf '%s\n' "$normalized_file"
}

check_prefix_usage() {
  local file_path="$1"
  local expected_style="$2"
  local grep_output

  grep_output="$(mktemp)"

  if [ "$expected_style" = "codex" ]; then
    if grep -nE "(^|[^[:alnum:]_.-])/(${COMMAND_ALT})([^[:alnum:]-]|$)" "$file_path" >"$grep_output"; then
      report_issue "Codex skill uses slash command '/<cmd>' in ${file_path}"
      if [ "$MODE" != "count" ]; then
        sed 's/^/  /' "$grep_output" >&2
      fi
    fi
  elif [ "$expected_style" = "gemini" ]; then
    if grep -nE "(^|[^[:alnum:]_.-])\\\$(${COMMAND_ALT})([^[:alnum:]-]|$)" "$file_path" >"$grep_output"; then
      report_issue "Gemini skill uses dollar command '\$<cmd>' in ${file_path}"
      if [ "$MODE" != "count" ]; then
        sed 's/^/  /' "$grep_output" >&2
      fi
    fi
  else
    if grep -nE "(^|[^[:alnum:]_.-])\\\$(${COMMAND_ALT})([^[:alnum:]-]|$)" "$file_path" >"$grep_output"; then
      report_issue "Claude skill uses dollar command '\$<cmd>' in ${file_path}"
      if [ "$MODE" != "count" ]; then
        sed 's/^/  /' "$grep_output" >&2
      fi
    fi
  fi

  rm -f "$grep_output"
}

compare_normalized_pair() {
  local label="$1"
  local left_file="$2"
  local right_file="$3"

  local left_norm
  local right_norm
  local diff_output
  diff_output="$(mktemp)"

  left_norm="$(get_normalized_file "$left_file")"
  right_norm="$(get_normalized_file "$right_file")"

  if ! diff -u "$left_norm" "$right_norm" >"$diff_output"; then
    report_issue "Semantic drift detected for ${label}"
    if [ "$MODE" != "count" ]; then
      sed -n '1,120p' "$diff_output" >&2
    fi
  fi

  rm -f "$diff_output"
}

check_registry_generation() {
  local gendoc_output
  gendoc_output="$(mktemp)"

  if [ ! -d .claude/skills ]; then
    rm -f "$gendoc_output"
    return
  fi

  # Skip generator parity until generatePreenDocs is migrated to skills-only output.
  if ! rg -q '\.claude/skills/preen/SKILL\.md' scripts/preen/generatePreenDocs.sh; then
    rm -f "$gendoc_output"
    return
  fi

  if [ ! -x ./scripts/preen/generatePreenDocs.sh ]; then
    report_issue "Missing executable generator: scripts/preen/generatePreenDocs.sh"
    rm -f "$gendoc_output"
    return
  fi

  if ! ./scripts/preen/generatePreenDocs.sh --check >"$gendoc_output" 2>&1; then
    report_issue "Top-level preen docs are not generated from scripts/preen/registry.json"
    if [ "$MODE" != "count" ]; then
      sed -n '1,120p' "$gendoc_output" >&2
    fi
  fi

  rm -f "$gendoc_output"
}

# Prefix-style lint for preen ecosystem files.
while IFS= read -r codex_skill_file; do
  check_prefix_usage "$codex_skill_file" codex
done < <(find .codex/skills -type f -name 'SKILL.md' | grep -E '/preen[^/]*/SKILL\.md$|/misc/preen-enhancements/SKILL\.md$' | sort)

while IFS= read -r gemini_skill_file; do
  check_prefix_usage "$gemini_skill_file" gemini
done < <(find .gemini/skills -type f -name 'SKILL.md' | grep -E '/preen[^/]*/SKILL\.md$|/preen-enhancements/SKILL\.md$' | sort)

while IFS= read -r claude_command_file; do
  check_prefix_usage "$claude_command_file" claude
done < <(find .claude/skills -mindepth 1 -maxdepth 1 -type d -name 'preen*' -print | sort | sed 's#$#/SKILL.md#')

# Ensure preen skill id parity.
mapfile -t CLAUDE_PREEN_IDS < <(find .claude/skills -mindepth 1 -maxdepth 1 -type d -name 'preen-*' -print | sed 's#.*/##' | sort)
mapfile -t CODEX_PREEN_IDS < <(find .codex/skills -maxdepth 1 -mindepth 1 -type d -name 'preen-*' -print | sed 's#.*/##' | sort)
mapfile -t GEMINI_PREEN_IDS < <(find .gemini/skills -maxdepth 1 -mindepth 1 -type d -name 'preen-*' -print | sed 's#.*/##' | sort)

CLAUDE_LIST_FILE="$(mktemp)"
CODEX_LIST_FILE="$(mktemp)"
GEMINI_LIST_FILE="$(mktemp)"
printf '%s\n' "${CLAUDE_PREEN_IDS[@]}" > "$CLAUDE_LIST_FILE"
printf '%s\n' "${CODEX_PREEN_IDS[@]}" > "$CODEX_LIST_FILE"
printf '%s\n' "${GEMINI_PREEN_IDS[@]}" > "$GEMINI_LIST_FILE"

while IFS= read -r missing_in_codex; do
  if [ -n "$missing_in_codex" ]; then
    report_issue "Missing Codex preen skill for ${missing_in_codex}"
  fi
done < <(comm -23 "$CLAUDE_LIST_FILE" "$CODEX_LIST_FILE")

while IFS= read -r missing_in_gemini; do
  if [ -n "$missing_in_gemini" ]; then
    report_issue "Missing Gemini preen skill for ${missing_in_gemini}"
  fi
done < <(comm -23 "$CLAUDE_LIST_FILE" "$GEMINI_LIST_FILE")

while IFS= read -r missing_in_claude; do
  if [ -n "$missing_in_claude" ]; then
    report_issue "Missing Claude preen skill for ${missing_in_claude}"
  fi
done < <(comm -13 "$CLAUDE_LIST_FILE" "$CODEX_LIST_FILE")

rm -f "$CLAUDE_LIST_FILE" "$CODEX_LIST_FILE" "$GEMINI_LIST_FILE"

# Compare semantic parity for paired preen skills.
for preen_id in "${CLAUDE_PREEN_IDS[@]}"; do
  claude_file=".claude/skills/${preen_id}/SKILL.md"
  codex_file=".codex/skills/${preen_id}/SKILL.md"
  gemini_file=".gemini/skills/${preen_id}/SKILL.md"

  if [ -f "$claude_file" ] && [ -f "$codex_file" ]; then
    compare_normalized_pair "$preen_id (Claude/Codex)" "$claude_file" "$codex_file"
  fi
  if [ -f "$claude_file" ] && [ -f "$gemini_file" ]; then
    compare_normalized_pair "$preen_id (Claude/Gemini)" "$claude_file" "$gemini_file"
  fi
done

# Compare top-level preen docs.
if [ -f .claude/skills/preen/SKILL.md ] && [ -f .codex/skills/preen/SKILL.md ]; then
  compare_normalized_pair "preen (Claude/Codex)" .claude/skills/preen/SKILL.md .codex/skills/preen/SKILL.md
fi
if [ -f .claude/skills/preen/SKILL.md ] && [ -f .gemini/skills/preen/SKILL.md ]; then
  compare_normalized_pair "preen (Claude/Gemini)" .claude/skills/preen/SKILL.md .gemini/skills/preen/SKILL.md
fi

check_registry_generation

if [ "$MODE" = "count" ]; then
  echo "$ISSUES"
  exit 0
fi

if [ "$ISSUES" -eq 0 ]; then
  if [ "$MODE" != "count" ]; then
    echo "[preen-check] OK" >&2
  fi
  exit 0
fi

if [ "$MODE" = "strict" ]; then
  echo "[preen-check] Found ${ISSUES} issue(s)" >&2
  exit 1
fi

echo "[preen-check] Found ${ISSUES} issue(s) (summary mode)" >&2
exit 0
