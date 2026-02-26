#!/usr/bin/env bash
# Document rendering for generatePreenDocs.sh (frontmatter through discovery)
# Sourced by generatePreenDocs.sh — do not run directly.

# shellcheck disable=SC2034  # RENDER_MERGE_QUEUE_COMMAND used by generatePreenDocsContentCont.sh
render_document_part1() {
  local platform="$1"

  case "$platform" in
    claude)
      RENDER_FRONTMATTER=$(cat <<'EOF_FRONTMATTER'
---
description: Stateful preening across all preen skills (project)
---
EOF_FRONTMATTER
)
      RENDER_MERGE_QUEUE_COMMAND='/enter-merge-queue'
      ;;
    codex)
      RENDER_FRONTMATTER=$(cat <<'EOF_FRONTMATTER'
---
name: preen
description: Stateful preening across all preen skills. Lands focused improvements, opens a PR, and enters merge queue.
---
EOF_FRONTMATTER
)
      RENDER_MERGE_QUEUE_COMMAND="\$enter-merge-queue"
      ;;
    gemini)
      RENDER_FRONTMATTER=$(cat <<'EOF_FRONTMATTER'
---
name: preen
description: Stateful preening across all preen skills. Lands focused improvements, opens a PR, and enters merge queue.
---
EOF_FRONTMATTER
)
      RENDER_MERGE_QUEUE_COMMAND="/enter-merge-queue"
      ;;
    *)
      echo "Error: unknown platform '$platform'" >&2
      exit 1
      ;;
  esac

  printf '%s\n\n' "$RENDER_FRONTMATTER"

  cat <<'EOF_BLOCK'
# Preen All

Perform a proactive, stateful pass through preen skills, implement focused improvements, open a PR, and enter the merge queue.

## When to Run

Run this meta-skill regularly for continuous quality improvement. It supports broad sweeps in default mode and targeted incremental passes in rotating modes.

## Self-Update Check (CRITICAL)

Before running, verify skill parity, command syntax, and registry drift:

1. Run ecosystem checks:

```bash
./scripts/checks/preen/checkPreenEcosystem.ts --summary
```

1. Ensure top-level preen docs are generated from registry:

```bash
./scripts/preen/generatePreenDocs.sh --check
```

If checks fail, STOP and sync before running preen:

```bash
./scripts/preen/generatePreenDocs.sh
./scripts/checks/preen/checkPreenEcosystem.ts --strict
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

## Historical Analysis (Self-Improvement)

Before running discovery, analyze past runs to inform category selection and surface improvement opportunities:

```bash
analyze_history() {
  [ ! -f "$RUNS_FILE" ] && return
  [ "$(wc -l < "$RUNS_FILE" 2>/dev/null)" -lt 5 ] && return

  # Categories with zero improvements in last 10 runs (stale)
  STALE_CATEGORIES=$(jq -s '
    [.[-10:][].selected_category] | group_by(.) |
    map({cat: .[0], runs: length}) |
    map(select(.runs > 2)) |
    [.[].cat] - [
      [.[-10:][] | select(.outcome == "changed") | .selected_category] | unique | .[]
    ]' "$RUNS_FILE" 2>/dev/null | jq -r '.[]' | tr '\n' ' ')

  # Categories never selected (under-served) - computed efficiently with jq
  ALL_CATEGORIES_JSON=$(printf '%s\n' "${CATEGORIES[@]}" | jq -R . | jq -s .)
  UNDER_SERVED=$(jq -s --argjson all_cats "$ALL_CATEGORIES_JSON" \
    '($all_cats - ([.[].selected_category] | unique)) | .[]' \
    "$RUNS_FILE" 2>/dev/null | tr -d '"' | tr '\n' ' ')

  # Success rate by category (effectiveness ranking)
  EFFECTIVENESS=$(jq -s '
    group_by(.selected_category) |
    map({
      cat: .[0].selected_category,
      total: length,
      success: ([.[] | select(.outcome == "changed")] | length),
      rate: (([.[] | select(.outcome == "changed")] | length) / length * 100 | floor)
    }) |
    sort_by(-.rate)' "$RUNS_FILE" 2>/dev/null)

  # Average improvement delta by category
  AVG_DELTA=$(jq -s '
    [.[] | select(.outcome == "changed")] |
    group_by(.selected_category) |
    map({
      cat: .[0].selected_category,
      avg_delta: ([.[].delta | tonumber] | add / length | floor)
    }) |
    sort_by(.avg_delta)' "$RUNS_FILE" 2>/dev/null)
}

analyze_history
```

### Adaptive Category Selection

Use historical insights to adjust category priority:

```bash
compute_category_boost() {
  local cat="$1"
  local boost=0

  # Boost under-served categories (+2)
  if echo "$UNDER_SERVED" | grep -q -w "$cat"; then
    boost=$((boost + 2))
  fi

  # Boost categories not run in last 5 iterations (+1)
  RECENT=$(jq -s --arg c "$cat" '[.[-5:][].selected_category] | map(select(. == $c)) | length' "$RUNS_FILE" 2>/dev/null || echo 0)
  if [ "$RECENT" -eq 0 ]; then
    boost=$((boost + 1))
  fi

  # Penalize stale categories (-1)
  if echo "$STALE_CATEGORIES" | grep -q -w "$cat"; then
    boost=$((boost - 1))
  fi

  echo "$boost"
}
```

Integrate boost into candidate scoring:

```text
adjusted_score = base_score + category_boost
base_score = (severity * 3) + (blast_radius * 2) + (confidence * 2) - effort
```

## Workflow

### 0. Health Report (Self-Improvement)

Output a health report when sufficient history exists to guide focus areas:

```bash
if [ -f "$RUNS_FILE" ] && [ "$(wc -l < "$RUNS_FILE" 2>/dev/null)" -gt 5 ]; then
  echo "=== Preen Health Report ==="

  # Last run timestamp per category (read file once for efficiency)
  echo "Category Coverage (last run):"
  LAST_RUNS_JSON=$(jq -s 'group_by(.selected_category) | map({(.[0].selected_category): (last.timestamp)}) | add // {}' "$RUNS_FILE" 2>/dev/null)
  for cat in "${CATEGORIES[@]}"; do
    LAST=$(echo "$LAST_RUNS_JSON" | jq -r --arg c "$cat" '.[$c] // "never"')
    printf "  %-30s %s\n" "$cat:" "$LAST"
  done

  # Success rate per category (last 20 runs)
  echo ""
  echo "Success Rates (last 20 runs):"
  jq -s '
    .[-20:] | group_by(.selected_category) |
    map(select(.[0].selected_category != null and .[0].selected_category != "")) |
    map({
      cat: .[0].selected_category,
      rate: (([.[] | select(.outcome == "changed")] | length) / length * 100 | floor)
    }) |
    sort_by(-.rate) |
    .[] | "  \(.cat): \(.rate)%"' "$RUNS_FILE" 2>/dev/null || true

  # Recommendations based on analysis
  echo ""
  echo "Recommendations:"
  [ -n "$STALE_CATEGORIES" ] && echo "  - Review stale categories (0 changes in 10 runs): $STALE_CATEGORIES"
  [ -n "$UNDER_SERVED" ] && echo "  - Prioritize under-served categories: $UNDER_SERVED"

  # Check for consistently empty discovery
  echo ""
  echo "Discovery Health:"
  for cat in "${ACTIVE_CATEGORIES[@]}"; do
    METRIC=$(metric_count "$cat" 2>/dev/null || echo "error")
    if [ "$METRIC" = "0" ]; then
      echo "  - WARNING: $cat discovery returns 0 findings - consider updating patterns"
    fi
  done

  echo "==========================="
fi
```

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
EOF_BLOCK
}
