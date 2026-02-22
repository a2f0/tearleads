#!/usr/bin/env bash
# Document rendering for generatePreenDocs.sh (second half: selection through end)
# Sourced by generatePreenDocs.sh — do not run directly.
# Uses RENDER_MERGE_QUEUE_COMMAND set by render_document_part1.

render_document_part2() {
  local merge_queue_command="$RENDER_MERGE_QUEUE_COMMAND"

  cat <<'EOF_BLOCK'

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
