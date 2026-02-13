#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE' >&2
Usage: ./scripts/checkPreenEcosystem.sh [--strict|--summary|--count-issues]

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

mapfile -t COMMAND_NAMES < <(find .claude/commands -maxdepth 1 -type f -name '*.md' -print | sed 's#.*/##;s#\.md$##' | sort)

if [ "${#COMMAND_NAMES[@]}" -eq 0 ]; then
  echo "Error: no command names found under .claude/commands" >&2
  exit 1
fi

ISSUES=0

report_issue() {
  ISSUES=$((ISSUES + 1))
  if [ "$MODE" != "count" ]; then
    echo "[preen-check] $1" >&2
  fi
}

normalize_file() {
  local source_file="$1"
  local output_file="$2"
  local working_file

  working_file="$(mktemp)"

  awk '
    NR == 1 && $0 == "---" { in_frontmatter = 1; next }
    in_frontmatter && $0 == "---" { in_frontmatter = 0; next }
    in_frontmatter { next }
    { print }
  ' "$source_file" > "$working_file"

  mv "$working_file" "$output_file"

  local command_name
  for command_name in "${COMMAND_NAMES[@]}"; do
    sed -E "s#/${command_name}([^[:alnum:]-]|$)#<cmd:${command_name}>\\1#g; s#\\\$${command_name}([^[:alnum:]-]|$)#<cmd:${command_name}>\\1#g" "$output_file" > "$output_file.tmp"
    mv "$output_file.tmp" "$output_file"
  done

  sed -E 's/[[:space:]]+$//' "$output_file" > "$output_file.tmp"
  mv "$output_file.tmp" "$output_file"

  sed -E '/./,$!d' "$output_file" > "$output_file.tmp"
  mv "$output_file.tmp" "$output_file"
}

check_prefix_usage() {
  local file_path="$1"
  local expected_style="$2"
  local command_name

  for command_name in "${COMMAND_NAMES[@]}"; do
    if [ "$expected_style" = "codex" ]; then
      if grep -nE "(^|[^[:alnum:]_.-])/${command_name}([^[:alnum:]-]|$)" "$file_path" >/tmp/preen-check-grep.txt; then
        report_issue "Codex skill uses slash command '/${command_name}' in ${file_path}"
        if [ "$MODE" != "count" ]; then
          sed 's/^/  /' /tmp/preen-check-grep.txt >&2
        fi
      fi
    else
      if grep -nE "(^|[^[:alnum:]_.-])\\\$${command_name}([^[:alnum:]-]|$)" "$file_path" >/tmp/preen-check-grep.txt; then
        report_issue "Claude command uses dollar command '\$${command_name}' in ${file_path}"
        if [ "$MODE" != "count" ]; then
          sed 's/^/  /' /tmp/preen-check-grep.txt >&2
        fi
      fi
    fi
  done
}

compare_normalized_pair() {
  local label="$1"
  local left_file="$2"
  local right_file="$3"

  local left_norm
  local right_norm
  left_norm="$(mktemp)"
  right_norm="$(mktemp)"

  normalize_file "$left_file" "$left_norm"
  normalize_file "$right_file" "$right_norm"

  if ! diff -u "$left_norm" "$right_norm" >/tmp/preen-check-diff.txt; then
    report_issue "Semantic drift detected for ${label}"
    if [ "$MODE" != "count" ]; then
      sed -n '1,120p' /tmp/preen-check-diff.txt >&2
    fi
  fi

  rm -f "$left_norm" "$right_norm"
}

check_registry_generation() {
  if [ ! -x ./scripts/preen/generatePreenDocs.sh ]; then
    report_issue "Missing executable generator: scripts/preen/generatePreenDocs.sh"
    return
  fi

  if ! ./scripts/preen/generatePreenDocs.sh --check >/tmp/preen-check-gendoc.txt 2>&1; then
    report_issue "Top-level preen docs are not generated from scripts/preen/registry.json"
    if [ "$MODE" != "count" ]; then
      sed -n '1,120p' /tmp/preen-check-gendoc.txt >&2
    fi
  fi
}

# Prefix-style lint for preen ecosystem files.
while IFS= read -r codex_skill_file; do
  check_prefix_usage "$codex_skill_file" codex
done < <(find .codex/skills -type f -name 'SKILL.md' | grep -E '/preen[^/]*/SKILL\.md$|/misc/preen-enhancements/SKILL\.md$' | sort)

while IFS= read -r claude_command_file; do
  check_prefix_usage "$claude_command_file" claude
done < <(find .claude/commands -maxdepth 1 -type f -name 'preen*.md' | sort)

# Ensure preen skill id parity.
mapfile -t CLAUDE_PREEN_IDS < <(find .claude/commands -maxdepth 1 -type f -name 'preen-*.md' -print | sed 's#.*/##;s#\.md$##' | sort)
mapfile -t CODEX_PREEN_IDS < <(find .codex/skills -maxdepth 1 -mindepth 1 -type d -name 'preen-*' -print | sed 's#.*/##' | sort)

CLAUDE_LIST_FILE="$(mktemp)"
CODEX_LIST_FILE="$(mktemp)"
printf '%s\n' "${CLAUDE_PREEN_IDS[@]}" > "$CLAUDE_LIST_FILE"
printf '%s\n' "${CODEX_PREEN_IDS[@]}" > "$CODEX_LIST_FILE"

while IFS= read -r missing_in_codex; do
  if [ -n "$missing_in_codex" ]; then
    report_issue "Missing Codex preen skill for ${missing_in_codex}"
  fi
done < <(comm -23 "$CLAUDE_LIST_FILE" "$CODEX_LIST_FILE")

while IFS= read -r missing_in_claude; do
  if [ -n "$missing_in_claude" ]; then
    report_issue "Missing Claude preen command for ${missing_in_claude}"
  fi
done < <(comm -13 "$CLAUDE_LIST_FILE" "$CODEX_LIST_FILE")

rm -f "$CLAUDE_LIST_FILE" "$CODEX_LIST_FILE"

# Compare semantic parity for paired preen skills.
for preen_id in "${CLAUDE_PREEN_IDS[@]}"; do
  claude_file=".claude/commands/${preen_id}.md"
  codex_file=".codex/skills/${preen_id}/SKILL.md"

  if [ -f "$claude_file" ] && [ -f "$codex_file" ]; then
    compare_normalized_pair "$preen_id" "$claude_file" "$codex_file"
  fi
done

# Compare top-level preen docs.
if [ -f .claude/commands/preen.md ] && [ -f .codex/skills/preen/SKILL.md ]; then
  compare_normalized_pair "preen" .claude/commands/preen.md .codex/skills/preen/SKILL.md
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
