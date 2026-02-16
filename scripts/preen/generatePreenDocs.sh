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
      ((.metricCountCommands // [.metricCountCommand])[] | "      " + .),
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
      merge_queue_command="\$enter-merge-queue"
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

**CRITICAL: Verify coverage thresholds before proceeding.**

Concurrent PR merges can cause cumulative coverage drops even when individual changes pass. Always verify coverage thresholds are maintained:

```bash
# Run coverage for packages with thresholds that may be affected
# Check which packages are impacted and run their coverage
# Note: Keep stdout visible here to see which packages are targeted
pnpm exec tsx scripts/ciImpact/runImpactedTests.ts
```

If coverage thresholds fail, **DO NOT proceed**. Add tests to bring coverage back above thresholds before continuing.

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

## Self-Improvement Protocol

The preen skill improves itself over time by analyzing run history and surfacing actionable recommendations.

### Self-Modification Triggers

| Trigger | Condition | Action |
|---------|-----------|--------|
| Stale category | 0 changes in last 10 runs | Suggest removal or discovery refinement |
| Discovery drift | `metric_count` returns 0 | Suggest updating discovery patterns |
| New anti-pattern | Manual fixes recur in uncovered area | Suggest new category proposal |
| High false-positive | Many audits, few changes (< 20% rate) | Suggest tightening discovery criteria |
| Under-served category | Never selected in recorded history | Boost priority or investigate blockers |

### Periodic Evaluation (Every 10 Runs)

After every 10 preen runs, evaluate:

1. **Stale Categories**: If a category has 0 changes in 10 consecutive runs:
   - Run discovery manually to verify patterns still exist in codebase
   - If patterns exist but aren't being selected, adjust scoring weights
   - If no patterns exist, consider removing category or updating discovery commands

2. **Under-Served Categories**: If coverage is uneven across categories:
   - Check if some categories have expensive/slow discovery commands
   - Consider splitting large categories into focused sub-categories
   - Verify category isn't blocked by environmental issues

3. **Registry Updates**: When discovery patterns need adjustment:
   - Update `scripts/preen/registry.json` with new discovery commands
   - Run `./scripts/preen/generatePreenDocs.sh` to regenerate skill docs
   - Test updated discovery with `PREEN_MODE=audit` before full run

4. **New Category Proposals**: When deferred-fixes reveal recurring patterns:

   ```bash
   # Find patterns in closed deferred-fix issues
   gh issue list --label deferred-fix --state closed --limit 50 --json title,body |
     jq -r '.[].title' | sort | uniq -c | sort -rn | head -10
   ```

   - If 3+ fixes cluster in same area, propose new preen category
   - Draft discovery commands and metric count for the pattern
   - Add to registry and regenerate docs

### Run History Analysis

Query the run log to understand preen effectiveness:

```bash
# Overall success rate
jq -s '
  {
    total: length,
    changed: ([.[] | select(.outcome == "changed")] | length),
    no_change: ([.[] | select(.outcome == "no-change")] | length),
    audit: ([.[] | select(.outcome == "audit")] | length)
  } |
  . + {success_rate: (.changed / .total * 100 | floor)}
' .git/preen/runs.jsonl

# Category leaderboard by impact
jq -s '
  [.[] | select(.outcome == "changed")] |
  group_by(.selected_category) |
  map({
    category: .[0].selected_category,
    runs: length,
    total_delta: ([.[].delta | tonumber] | add),
    avg_delta: ([.[].delta | tonumber] | add / length | floor)
  }) |
  sort_by(.total_delta)
' .git/preen/runs.jsonl

# Time since last successful change per category
jq -s '
  [.[] | select(.outcome == "changed")] |
  group_by(.selected_category) |
  map({category: .[0].selected_category, last_change: (last | .timestamp)}) |
  sort_by(.last_change)
' .git/preen/runs.jsonl
```

### When to Update This Skill

Update `.claude/commands/preen.md` when:

1. **Adding a new category**: Add to `CATEGORIES` array, `run_discovery` cases, `metric_count` cases
2. **Retiring a stale category**: Remove from arrays after confirming no value
3. **Adjusting scoring**: Modify `compute_category_boost` or base scoring formula
4. **Improving discovery**: Update discovery commands for better signal-to-noise
5. **Adding security categories**: Also add to `SECURITY_CATEGORIES` array

Always regenerate from registry after structural changes:

```bash
./scripts/preen/generatePreenDocs.sh
./scripts/checkPreenEcosystem.sh --strict
```

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
