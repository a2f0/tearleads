#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE' >&2
Usage: ./scripts/preen/generatePreenDocs.sh [--check]

Without arguments, rewrites both:
  - .claude/commands/preen.md
  - .codex/skills/preen/SKILL.md

With --check, verifies generated output matches files and exits non-zero on drift.
USAGE
  exit 2
}

MODE="write"
if [ "$#" -gt 1 ]; then
  usage
fi
if [ "$#" -eq 1 ]; then
  case "$1" in
    --check)
      MODE="check"
      ;;
    *)
      usage
      ;;
  esac
fi

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

REGISTRY_FILE="scripts/preen/registry.json"
if [ ! -f "$REGISTRY_FILE" ]; then
  echo "Error: missing $REGISTRY_FILE" >&2
  exit 1
fi

render_table_rows() {
  jq -r '.categories[] | "| `\(.id)` | \(.purpose) |"' "$REGISTRY_FILE"
}

render_category_array() {
  jq -r '.categories[] | "  \"\(.id)\""' "$REGISTRY_FILE"
}

render_security_category_array() {
  jq -r '.categories[] | select(.security == true) | "  \"\(.id)\""' "$REGISTRY_FILE"
}

render_discovery_case() {
  jq -r '
    .categories[]
    | "    \(.id))",
      (.discoveryCommands[] | "      " + .),
      "      ;;"
  ' "$REGISTRY_FILE"
}

render_metric_case() {
  jq -r '
    .categories[]
    | "    \(.id))",
      "      " + .metricCountCommand,
      "      ;;"
  ' "$REGISTRY_FILE"
}

render_quality_metrics() {
  jq -r '.categories[] | "- \(.qualityMetric)"' "$REGISTRY_FILE"
}

render_checklist_rows() {
  jq -r '.categories[] | "- [ ] \(.checklistLabel)"' "$REGISTRY_FILE"
}

render_document() {
  local platform="$1"
  local merge_queue_command
  local frontmatter

  case "$platform" in
    claude)
      frontmatter=$(cat <<'EOF_FRONTMATTER'
---
description: Stateful preening across all preen skills (project)
---
EOF_FRONTMATTER
)
      merge_queue_command='/enter-merge-queue'
      ;;
    codex)
      frontmatter=$(cat <<'EOF_FRONTMATTER'
---
name: preen
description: Stateful preening across all preen skills. Lands focused improvements, opens a PR, and enters merge queue.
---
EOF_FRONTMATTER
)
      merge_queue_command='$enter-merge-queue'
      ;;
    *)
      echo "Error: unknown platform '$platform'" >&2
      exit 1
      ;;
  esac

  printf '%s\n\n' "$frontmatter"

  cat <<'EOF_BLOCK'
# Preen All

Perform a proactive, stateful pass through preen skills, implement focused improvements, open a PR, and enter the merge queue.

## When to Run

Run this meta-skill regularly for continuous quality improvement. It supports broad sweeps in default mode and targeted incremental passes in rotating modes.

## Self-Update Check (CRITICAL)

Before running, verify skill parity, command syntax, and registry drift:

1. Run ecosystem checks:

```bash
./scripts/checkPreenEcosystem.sh --summary
```

1. Ensure top-level preen docs are generated from registry:

```bash
./scripts/preen/generatePreenDocs.sh --check
```

If checks fail, STOP and sync before running preen:

```bash
./scripts/preen/generatePreenDocs.sh
./scripts/checkPreenEcosystem.sh --strict
```

## Preen Skills Registry

| Skill | Purpose |
| ----- | ------- |
EOF_BLOCK

  render_table_rows

  cat <<'EOF_BLOCK'

## Run Modes

Use `PREEN_MODE` to control scope:

| Mode | Behavior |
| ---- | -------- |
| `full` (default) | Run all categories and land at most one fix per category |
| `single` | Run exactly one rotating category and land at most one fix |
| `security` | Run only security categories and land at most one fix |
| `audit` | Run discovery + scoring only; no edits, no branch, no PR |

## Stateful Iteration (CRITICAL)

Persist rotation state locally so repeated runs in rotating modes naturally cover the full quality surface.

```bash
MODE="${PREEN_MODE:-full}"
STATE_DIR=".git/preen"
CURSOR_FILE="$STATE_DIR/cursor"
RUNS_FILE="$STATE_DIR/runs.jsonl"

CATEGORIES=(
EOF_BLOCK

  render_category_array

  cat <<'EOF_BLOCK'
)

SECURITY_CATEGORIES=(
EOF_BLOCK

  render_security_category_array

  cat <<'EOF_BLOCK'
)

mkdir -p "$STATE_DIR"
[ -f "$CURSOR_FILE" ] || echo 0 > "$CURSOR_FILE"
CURSOR=$(cat "$CURSOR_FILE")

case "$MODE" in
  single)
    ACTIVE_CATEGORIES=("${CATEGORIES[$CURSOR]}")
    NEXT_CURSOR=$(( (CURSOR + 1) % ${#CATEGORIES[@]} ))
    MAX_FIXES=1
    ;;
  full)
    ACTIVE_CATEGORIES=("${CATEGORIES[@]}")
    NEXT_CURSOR="$CURSOR"
    MAX_FIXES=${#CATEGORIES[@]}
    ;;
  security)
    ACTIVE_CATEGORIES=("${SECURITY_CATEGORIES[@]}")
    NEXT_CURSOR="$CURSOR"
    MAX_FIXES=1
    ;;
  audit)
    ACTIVE_CATEGORIES=("${CATEGORIES[$CURSOR]}")
    NEXT_CURSOR=$(( (CURSOR + 1) % ${#CATEGORIES[@]} ))
    MAX_FIXES=0
    ;;
  *)
    echo "Unknown PREEN_MODE: $MODE"
    exit 1
    ;;
esac

printf 'mode=%s active=%s max_fixes=%s\n' "$MODE" "${ACTIVE_CATEGORIES[*]}" "$MAX_FIXES"
```

## Workflow

### 1. Setup (Hardened)

```bash
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree is not clean. Commit or stash changes before running preen."
  exit 1
fi

DEFAULT_BRANCH="$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null || true)"
if [ -z "$DEFAULT_BRANCH" ]; then
  DEFAULT_BRANCH="$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || true)"
fi
if [ -z "$DEFAULT_BRANCH" ]; then
  DEFAULT_BRANCH="main"
fi

git fetch origin "$DEFAULT_BRANCH"
git checkout "$DEFAULT_BRANCH"
git pull --ff-only origin "$DEFAULT_BRANCH"
```

### 2. Discovery (Active Categories Only)

Run discovery only for selected categories:

```bash
run_discovery() {
  case "$1" in
EOF_BLOCK

  render_discovery_case

  cat <<'EOF_BLOCK'
  esac
}

metric_count() {
  case "$1" in
EOF_BLOCK

  render_metric_case

  cat <<'EOF_BLOCK'
    *)
      echo 0
      ;;
  esac
}

for category in "${ACTIVE_CATEGORIES[@]}"; do
  run_discovery "$category"
done
```

### 3. Selection, Scoring, and Baseline

For each active category, select the highest-value candidate with this rubric:

`score = (severity * 3) + (blast_radius * 2) + (confidence * 2) - effort`

Selection guardrails:

- `single`: maximum 1 total fix in the run
- `full`: maximum 1 fix per active category
- `security`: maximum 1 security fix
- `audit`: no fixes (discovery and scoring only)

Do not pick a candidate if confidence is low or behavior impact is unclear.

Capture baseline for the selected category:

```bash
SELECTED_CATEGORY="<set-after-scoring>"
SELECTED_CANDIDATE="<short-description>"
BASELINE_COUNT=0

if [ -n "${SELECTED_CATEGORY:-}" ]; then
  BASELINE_COUNT=$(metric_count "$SELECTED_CATEGORY")
fi
```

### 4. Decision Gate and Branch Creation

Create a branch only after a candidate is selected and only for non-audit runs:

```bash
if [ "$MODE" = "audit" ] || [ -z "${SELECTED_CATEGORY:-}" ]; then
  OUTCOME=$([ "$MODE" = "audit" ] && echo "audit" || echo "no-change")
  echo "$NEXT_CURSOR" > "$CURSOR_FILE"

  jq -nc \
    --arg timestamp "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    --arg mode "$MODE" \
    --arg active "${ACTIVE_CATEGORIES[*]}" \
    --arg selected "${SELECTED_CATEGORY:-}" \
    --arg candidate "${SELECTED_CANDIDATE:-}" \
    --arg baseline "$BASELINE_COUNT" \
    --arg after "" \
    --arg delta "" \
    --arg outcome "$OUTCOME" \
    --arg branch "" \
    --arg pr "" \
    '{timestamp:$timestamp,mode:$mode,active_categories:$active,selected_category:$selected,selected_candidate:$candidate,baseline_count:$baseline,after_count:$after,delta:$delta,outcome:$outcome,branch:$branch,pr:$pr}' >> "$RUNS_FILE"

  echo "No code changes made. Active categories: ${ACTIVE_CATEGORIES[*]}"
  exit 0
fi

BRANCH="refactor/preen-$(date +%Y%m%d-%H%M%S)"
git checkout -b "$BRANCH"
```

### 5. Implement Focused Fixes

Apply minimal, behavior-preserving changes and add/update tests where needed.

### 6. Validate

Run impacted checks first:

```bash
pnpm exec tsx scripts/ciImpact/runImpactedQuality.ts >/dev/null
pnpm exec tsx scripts/ciImpact/runImpactedTests.ts >/dev/null
```

Run full checks when the change is broad or security-sensitive:

```bash
pnpm typecheck >/dev/null
pnpm lint >/dev/null
pnpm test >/dev/null
```

### 7. Quality Delta Gate

Before opening a PR, record measurable improvement. Example metrics:

EOF_BLOCK

  render_quality_metrics

  cat <<'EOF_BLOCK'

Quality gate for the selected category:

```bash
AFTER_COUNT=$(metric_count "$SELECTED_CATEGORY")
if [ "$AFTER_COUNT" -ge "$BASELINE_COUNT" ]; then
  echo "Quality delta gate failed: baseline=$BASELINE_COUNT after=$AFTER_COUNT"
  exit 1
fi
```

### 8. Commit and Push

If changes were made:

```bash
git add -A
git commit -S -m "refactor(preen): stateful single-pass improvements" >/dev/null
git push -u origin "$BRANCH" >/dev/null
```

### 9. Open PR and Enter Merge Queue

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

PR_URL=$(gh pr create --repo "$REPO" --title "refactor(preen): stateful single-pass improvements" --body "$(cat <<'PR_BODY'
## Summary
- Ran stateful preen pass in `<mode>` mode
- Landed focused quality improvements with measurable delta

## Categories Checked
EOF_BLOCK

  render_checklist_rows

  cat <<'EOF_BLOCK'

## Quality Delta
- [x] Baseline metric captured for selected category
- [x] Post-change metric captured for selected category
- [x] Metric improved (`after < baseline`)

## Test Plan
- [x] Impacted quality checks pass
- [x] Impacted coverage checks pass
- [x] Additional full checks run when needed
PR_BODY
)")

PR_NUMBER=$(echo "$PR_URL" | rg -o '[0-9]+$' || true)
EOF_BLOCK

  printf '%s\n' "$merge_queue_command"

  cat <<'EOF_BLOCK'
```

### 10. Persist Cursor and Structured Run Log

Always persist rotation state and run metadata after evaluation:

```bash
OUTCOME="changed"
echo "$NEXT_CURSOR" > "$CURSOR_FILE"

jq -nc \
  --arg timestamp "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --arg mode "$MODE" \
  --arg active "${ACTIVE_CATEGORIES[*]}" \
  --arg selected "${SELECTED_CATEGORY:-}" \
  --arg candidate "${SELECTED_CANDIDATE:-}" \
  --arg baseline "$BASELINE_COUNT" \
  --arg after "$AFTER_COUNT" \
  --arg delta "$((AFTER_COUNT - BASELINE_COUNT))" \
  --arg outcome "$OUTCOME" \
  --arg branch "$BRANCH" \
  --arg pr "${PR_NUMBER:-}" \
  '{timestamp:$timestamp,mode:$mode,active_categories:$active,selected_category:$selected,selected_candidate:$candidate,baseline_count:$baseline,after_count:$after,delta:$delta,outcome:$outcome,branch:$branch,pr:$pr}' >> "$RUNS_FILE"
```

## No-Changes and Audit Cases

If no high-value candidate is found, or `audit` mode is used:

- Do not create a PR
- Still advance cursor in rotating modes (`single`, `audit`)
- Record structured run metadata in `.git/preen/runs.jsonl`

## Default-Mode Philosophy

Default `full` mode enables broad, category-by-category sweeps. Use `single` when you want smaller, lower-risk incremental changes that rotate over time.

## Guardrails

- In `single` mode, do not land more than one fix total
- In `full` mode, do not land more than one fix per category
- In `security` mode, do not land more than one security fix total
- In `audit` mode, do not make edits
- Do not change runtime behavior unless fixing a bug
- Do not introduce new `any`, unsafe casts, or `@ts-ignore`
- Do not create empty PRs
- Keep each fix focused and independently verifiable

## Token Efficiency

```bash
pnpm exec tsx scripts/ciImpact/runImpactedQuality.ts >/dev/null
pnpm exec tsx scripts/ciImpact/runImpactedTests.ts >/dev/null
pnpm typecheck >/dev/null
pnpm lint >/dev/null
pnpm test >/dev/null
git commit -S -m "message" >/dev/null
git push >/dev/null
```

On failure, re-run the failing command without suppression.
EOF_BLOCK
}

check_or_write_file() {
  local destination="$1"
  local content="$2"

  if [ "$MODE" = "write" ]; then
    printf '%s\n' "$content" > "$destination"
    return
  fi

  local temp_file
  temp_file="$(mktemp)"
  printf '%s\n' "$content" > "$temp_file"

  if ! diff -u "$destination" "$temp_file" >/dev/null; then
    echo "Drift detected in $destination" >&2
    diff -u "$destination" "$temp_file" >&2 || true
    rm -f "$temp_file"
    return 1
  fi

  rm -f "$temp_file"
  return 0
}

CLAUDE_DOC_CONTENT="$(render_document claude)"
CODEX_DOC_CONTENT="$(render_document codex)"

FAILED=0
check_or_write_file ".claude/commands/preen.md" "$CLAUDE_DOC_CONTENT" || FAILED=1
check_or_write_file ".codex/skills/preen/SKILL.md" "$CODEX_DOC_CONTENT" || FAILED=1

if [ "$MODE" = "check" ] && [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "preen docs are up to date"
