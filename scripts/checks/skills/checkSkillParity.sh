#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE' >&2
Usage: ./scripts/checks/skills/checkSkillParity.sh [--strict|--summary|--count-issues]

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

if [ ! -d .codex/skills ] || [ ! -d .gemini/skills ] || [ ! -d .claude/skills ]; then
  echo "Error: missing one or more required skill directories (.codex, .gemini, .claude)" >&2
  exit 1
fi
HAS_OPENCODE=0
if [ -d .opencode/skills ]; then
  HAS_OPENCODE=1
fi
if [ "$HAS_OPENCODE" -ne 1 ]; then
  if [ "$MODE" = "count" ]; then
    echo "0"
  else
    echo "[skill-parity] Skipping: .opencode/skills not present" >&2
  fi
  exit 0
fi

ISSUES=0

report_issue() {
  ISSUES=$((ISSUES + 1))
  if [ "$MODE" != "count" ]; then
    echo "[skill-parity] $1" >&2
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
  while IFS= read -r command_name; do
    if [ -n "$command_name" ]; then
      sed -E "s#/${command_name}([^[:alnum:]-]|$)#<cmd:${command_name}>\\1#g; s#\\\$${command_name}([^[:alnum:]-]|$)#<cmd:${command_name}>\\1#g" "$output_file" > "$output_file.tmp"
      mv "$output_file.tmp" "$output_file"
    fi
  done < <(find .claude/skills -mindepth 1 -maxdepth 1 -type d -print | sed 's#.*/##' | sort)

  sed -E 's/[[:space:]]+$//' "$output_file" > "$output_file.tmp"
  mv "$output_file.tmp" "$output_file"

  sed -E '/./,$!d' "$output_file" > "$output_file.tmp"
  mv "$output_file.tmp" "$output_file"
}

compare_normalized_pair() {
  local label="$1"
  local left_file="$2"
  local right_file="$3"

  local left_norm
  local right_norm
  local diff_output
  left_norm="$(mktemp)"
  right_norm="$(mktemp)"
  diff_output="$(mktemp)"

  normalize_file "$left_file" "$left_norm"
  normalize_file "$right_file" "$right_norm"

  if ! diff -u "$left_norm" "$right_norm" >"$diff_output"; then
    report_issue "Semantic drift detected for ${label}"
    if [ "$MODE" != "count" ]; then
      sed -n '1,160p' "$diff_output" >&2
    fi
  fi

  rm -f "$left_norm" "$right_norm" "$diff_output"
}

normalize_codex_id() {
  local raw_id="$1"
  if [ "$raw_id" = "misc/preen-enhancements" ]; then
    echo "preen-enhancements"
    return
  fi
  echo "$raw_id"
}

collect_codex_ids() {
  find .codex/skills -type f -name 'SKILL.md' -print | while read -r skill_file; do
    local dir
    local id
    dir="$(dirname "$skill_file")"
    id="${dir#.codex/skills/}"
    normalize_codex_id "$id"
  done | sort -u
}

collect_gemini_ids() {
  find .gemini/skills -type f -name 'SKILL.md' -print | while read -r skill_file; do
    local dir
    dir="$(dirname "$skill_file")"
    echo "${dir#.gemini/skills/}"
  done | sort -u
}

collect_opencode_ids() {
  if [ "$HAS_OPENCODE" -ne 1 ]; then
    return
  fi
  find .opencode/skills -type f -name 'SKILL.md' -print | while read -r skill_file; do
    local dir
    dir="$(dirname "$skill_file")"
    echo "${dir#.opencode/skills/}"
  done | sort -u
}

collect_claude_ids() {
  find .claude/skills -mindepth 1 -maxdepth 1 -type d -print | sed 's#.*/##' | sort -u
}

CODEX_LIST_FILE="$(mktemp)"
GEMINI_LIST_FILE="$(mktemp)"
OPENCODE_LIST_FILE="$(mktemp)"
CLAUDE_LIST_FILE="$(mktemp)"

collect_codex_ids > "$CODEX_LIST_FILE"
collect_gemini_ids > "$GEMINI_LIST_FILE"
collect_opencode_ids > "$OPENCODE_LIST_FILE"
collect_claude_ids > "$CLAUDE_LIST_FILE"

while IFS= read -r missing_in_gemini; do
  if [ -n "$missing_in_gemini" ]; then
    report_issue "Missing Gemini skill for ${missing_in_gemini}"
  fi
done < <(comm -23 "$CODEX_LIST_FILE" "$GEMINI_LIST_FILE")

while IFS= read -r missing_in_opencode; do
  if [ -n "$missing_in_opencode" ]; then
    report_issue "Missing OpenCode skill for ${missing_in_opencode}"
  fi
done < <(
  if [ "$HAS_OPENCODE" -eq 1 ]; then
    comm -23 "$CODEX_LIST_FILE" "$OPENCODE_LIST_FILE"
  fi
)

while IFS= read -r missing_in_codex; do
  if [ -n "$missing_in_codex" ]; then
    report_issue "Missing Codex skill for ${missing_in_codex}"
  fi
done < <(comm -13 "$CODEX_LIST_FILE" "$GEMINI_LIST_FILE")

while IFS= read -r missing_in_codex; do
  if [ -n "$missing_in_codex" ]; then
    report_issue "Missing Codex skill for ${missing_in_codex}"
  fi
done < <(
  if [ "$HAS_OPENCODE" -eq 1 ]; then
    comm -13 "$CODEX_LIST_FILE" "$OPENCODE_LIST_FILE"
  fi
)

while IFS= read -r missing_in_claude; do
  if [ -n "$missing_in_claude" ]; then
    report_issue "Missing Claude skill for ${missing_in_claude}"
  fi
done < <(comm -23 "$CODEX_LIST_FILE" "$CLAUDE_LIST_FILE")

rm -f "$CODEX_LIST_FILE" "$GEMINI_LIST_FILE" "$OPENCODE_LIST_FILE" "$CLAUDE_LIST_FILE"

# Compare parity for skills that exist in Codex and other platforms.
# Codex is canonical.
while IFS= read -r codex_skill; do
  [ -z "$codex_skill" ] && continue

  local_codex_file=".codex/skills/${codex_skill}/SKILL.md"
  if [ "$codex_skill" = "preen-enhancements" ]; then
    local_codex_file=".codex/skills/misc/preen-enhancements/SKILL.md"
  fi

  if [ -f "$local_codex_file" ]; then
    if [ -f ".gemini/skills/${codex_skill}/SKILL.md" ]; then
      compare_normalized_pair "${codex_skill} (Codex/Gemini)" "$local_codex_file" ".gemini/skills/${codex_skill}/SKILL.md"
    fi
    if [ "$HAS_OPENCODE" -eq 1 ] && [ -f ".opencode/skills/${codex_skill}/SKILL.md" ]; then
      compare_normalized_pair "${codex_skill} (Codex/OpenCode)" "$local_codex_file" ".opencode/skills/${codex_skill}/SKILL.md"
    fi
    if [ -f ".claude/skills/${codex_skill}/SKILL.md" ]; then
      compare_normalized_pair "${codex_skill} (Codex/Claude)" "$local_codex_file" ".claude/skills/${codex_skill}/SKILL.md"
    fi
  fi
done < <(collect_codex_ids)

if [ "$MODE" = "count" ]; then
  echo "$ISSUES"
  exit 0
fi

if [ "$ISSUES" -eq 0 ]; then
  if [ "$MODE" != "count" ]; then
    echo "[skill-parity] OK" >&2
  fi
  exit 0
fi

if [ "$MODE" = "strict" ]; then
  echo "[skill-parity] Found ${ISSUES} issue(s)" >&2
  exit 1
fi

echo "[skill-parity] Found ${ISSUES} issue(s) (summary mode)" >&2
exit 0
