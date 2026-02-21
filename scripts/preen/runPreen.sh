#!/usr/bin/env bash
# shellcheck disable=SC2034,SC2012,SC2038
set -euo pipefail

usage() {
  cat <<'USAGE' >&2
Usage: ./scripts/preen/runPreen.sh [--mode aggressive|full|single|security|audit] [--passive] [--dry-run]

Options:
  --mode    Preen mode (default: $PREEN_MODE or aggressive)
  --passive Run discovery/analysis without mutating the workspace (for lambda/read-only environments)
  --dry-run Print the steps without mutating the workspace
  --help    Display this help message
USAGE
  exit 1
}

MODE="${PREEN_MODE:-aggressive}"
DRY_RUN=false
PASSIVE=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --mode)
      shift
      [ "$#" -gt 0 ] || usage
      MODE="$1"
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --passive)
      PASSIVE=true
      shift
      ;;
    --help)
      usage
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      ;;
  esac
done

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
STATE_DIR="$ROOT_DIR/.git/preen"
CURSOR_FILE="$STATE_DIR/cursor"
RUNS_FILE="$STATE_DIR/runs.jsonl"

CATEGORIES=(
  "preen-typescript"
  "preen-split-react-components"
  "preen-deferred-fixes"
  "preen-optimize-test-execution"
  "preen-database-performance"
  "preen-api-security"
  "preen-dependency-security"
  "preen-test-flakiness"
  "preen-msw-parity"
  "preen-skill-tooling"
  "preen-skill-parity"
  "preen-compliance-docs"
  "preen-package-docs"
  "preen-review-instructions"
  "preen-i18n"
  "preen-docs-internationalization"
  "preen-window-consistency"
  "preen-file-limits"
  "preen-knip"
)

SECURITY_CATEGORIES=(
  "preen-api-security"
  "preen-dependency-security"
)

mkdir -p "$STATE_DIR"
[ -f "$CURSOR_FILE" ] || echo 0 > "$CURSOR_FILE"
CURSOR=$(cat "$CURSOR_FILE")

ACTIVE_CATEGORIES=()
NEXT_CURSOR="$CURSOR"
MAX_FIXES=
MIN_FIXES=

case "$MODE" in
  aggressive)
    ACTIVE_CATEGORIES=("${CATEGORIES[@]}")
    MIN_FIXES=4
    MAX_FIXES=5
    NEXT_CURSOR="$CURSOR"
    ;;
  single)
    ACTIVE_CATEGORIES=("${CATEGORIES[$CURSOR]}")
    MIN_FIXES=1
    NEXT_CURSOR=$(( (CURSOR + 1) % ${#CATEGORIES[@]} ))
    MAX_FIXES=1
    ;;
  full)
    # Backward-compatible alias for aggressive mode.
    ACTIVE_CATEGORIES=("${CATEGORIES[@]}")
    MIN_FIXES=4
    MAX_FIXES=5
    NEXT_CURSOR="$CURSOR"
    ;;
  security)
    ACTIVE_CATEGORIES=("${SECURITY_CATEGORIES[@]}")
    MIN_FIXES=1
    MAX_FIXES=1
    NEXT_CURSOR="$CURSOR"
    ;;
  audit)
    ACTIVE_CATEGORIES=("${CATEGORIES[$CURSOR]}")
    MIN_FIXES=0
    MAX_FIXES=0
    NEXT_CURSOR=$(( (CURSOR + 1) % ${#CATEGORIES[@]} ))
    ;;
  *)
    echo "Unknown PREEN_MODE: $MODE" >&2
    exit 1
    ;;
esac

if [ -n "${PREEN_MIN_FIXES:-}" ]; then
  MIN_FIXES="$PREEN_MIN_FIXES"
fi
if [ -n "${PREEN_MAX_FIXES:-}" ]; then
  MAX_FIXES="$PREEN_MAX_FIXES"
fi

printf 'mode=%s active=%s min_fixes=%s max_fixes=%s\n' "$MODE" "${ACTIVE_CATEGORIES[*]}" "$MIN_FIXES" "$MAX_FIXES"
if [ "$PASSIVE" = true ]; then
  echo "passive=true (workspace mutations disabled)"
fi

analyze_history() {
  STALE_CATEGORIES=""
  UNDER_SERVED=""

  [ ! -f "$RUNS_FILE" ] && return
  [ "$(wc -l < "$RUNS_FILE" 2>/dev/null)" -lt 5 ] && return

  STALE_CATEGORIES=$(jq -s '
    [.[-10:][].selected_category] | group_by(.) |
    map({cat: .[0], runs: length}) |
    map(select(.runs > 2)) |
    [.[].cat] - [
      [.[-10:][] | select(.outcome == "changed") | .selected_category] | unique | .[]
    ]'
    "$RUNS_FILE" 2>/dev/null | jq -r '.[]' | tr '\n' ' ')

  ALL_CATEGORIES_JSON=$(printf '%s\n' "${CATEGORIES[@]}" | jq -R . | jq -s .)
  UNDER_SERVED=$(jq -s --argjson all_cats "$ALL_CATEGORIES_JSON" '
    ($all_cats - ([.[].selected_category] | unique)) | .[]'
    "$RUNS_FILE" 2>/dev/null | tr -d '"' | tr '\n' ' ')

}

run_discovery() {
  case "$1" in
    preen-typescript)
      rg -n --glob '*.{ts,tsx}' ': any|: any\[\]|<any>|as any|@ts-ignore|@ts-expect-error' . | head -20
      ;;
    preen-split-react-components)
      find . -name '*.tsx' -not -path '*/node_modules/*' -not -path '*/.next/*' -not -path '*/dist/*' -exec wc -l {} \; 2>/dev/null | awk '$1 > 300' | sort -rn | head -20
      ;;
    preen-deferred-fixes)
      REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)
      gh issue list -R "$REPO" --label 'deferred' --state open --limit 20 2>/dev/null || true
      ;;
    preen-optimize-test-execution)
      pnpm exec tsx scripts/ciImpact/ciImpact.ts --base origin/main --head HEAD | head -40
      ;;
    preen-database-performance)
      rg -n --multiline --multiline-dotall --glob '*.{ts,tsx}' 'for\s*\([^)]*\)\s*\{.{0,400}?await\s+[^\n;]*db\.(select|query|execute)' packages | head -40 || true
      rg -n --glob '*.{ts,tsx}' '\.(leftJoin|innerJoin|rightJoin|fullJoin|crossJoin)\(' packages | head -40 || true
      rg -n --glob '**/*.{test,spec}.{ts,tsx}' 'withRealDatabase\(|createTestDatabase\(' packages | head -40 || true
      ;;
    preen-api-security)
      rg -n --glob '*.ts' 'router\.(get|post|put|patch|delete)|authClaims|req\.session|pool\.query|client\.query' packages/api/src/routes | head -40
      ;;
    preen-dependency-security)
      pnpm audit --prod --audit-level high --json 2>/dev/null | head -40 || true
      rg -n --glob 'package.json' 'latest|next|canary|beta' packages scripts . | head -20 || true
      ;;
    preen-test-flakiness)
      rg -n --glob '**/*.{test,spec}.{ts,tsx}' 'setTimeout\(|waitForTimeout\(|sleep\(' packages . | head -30 || true
      rg -n --glob '**/*.{test,spec}.{ts,tsx}' 'retry|retries|flaky|TODO.*flaky' packages . | head -30 || true
      ;;
    preen-msw-parity)
      ./scripts/preen/checkMswParity.ts
      ./scripts/preen/checkMswParity.ts --json | head -40
      ;;
    preen-skill-tooling)
      ./scripts/checkPreenEcosystem.sh --summary
      ;;
    preen-skill-parity)
      ./scripts/checkSkillParity.sh --summary
      ;;
    preen-compliance-docs)
      for fw in HIPAA NIST.SP.800-53 SOC2; do
        echo "=== $fw ==="
        echo "Policies: $(ls compliance/$fw/policies/*.md 2>/dev/null | wc -l | tr -d ' ')"
        echo "Procedures: $(ls compliance/$fw/procedures/*.md 2>/dev/null | wc -l | tr -d ' ')"
        echo "Controls: $(ls compliance/$fw/technical-controls/*.md 2>/dev/null | wc -l | tr -d ' ')"
      done
      find compliance -name '*.md' -not -name 'POLICY_INDEX.md' -not -name 'AGENTS.md' | xargs -I{} basename {} | grep -v '^[0-9][0-9]-' | head -10
      ;;
    preen-package-docs)
      echo '=== Packages missing README ==='
      for pkg in packages/*/; do
        [ ! -f "${pkg}README.md" ] && basename "$pkg"
      done
      echo '=== Summary ==='
      total=$(ls -d packages/*/ | wc -l | tr -d ' ')
      with_readme=$(ls packages/*/README.md 2>/dev/null | wc -l | tr -d ' ')
      echo "$with_readme/$total packages have READMEs"
      ;;
    preen-review-instructions)
      echo '=== REVIEW.md sections ==='
      rg '^##' REVIEW.md | head -20
      echo '=== Gemini sections ==='
      rg '^##' .gemini/INSTRUCTIONS.md | head -20
      echo '=== Section comparison ==='
      echo "REVIEW.md: $(rg '^## ' REVIEW.md | wc -l | tr -d ' ')"
      echo "Gemini: $(rg '^## ' .gemini/INSTRUCTIONS.md | wc -l | tr -d ' ')"
      ;;
    preen-i18n)
      echo '=== Translation Files ==='
      find packages -path '*/i18n/translations/*.ts' -not -name 'types.ts' -not -name 'index.ts' | head -20
      echo '=== Key Count by Language ==='
      for lang in en es ua pt; do
        count=$(rg -o "^\s+\w+:" packages/client/src/i18n/translations/${lang}.ts 2>/dev/null | wc -l | tr -d ' ')
        echo "${lang}: ${count} keys"
      done
      echo '=== Potential Hardcoded Strings ==='
      rg -n --glob '*.tsx' '>\s*[A-Z][a-z]+(\s+[a-z]+)*\s*<' packages | rg -v 'test\.' | head -20
      ;;
    preen-docs-internationalization)
      echo '=== Translation Coverage ==='
      echo "English (source): $(ls docs/en/*.md 2>/dev/null | wc -l | tr -d ' ')"
      echo "Spanish: $(ls docs/es/*.md 2>/dev/null | wc -l | tr -d ' ')"
      echo "Ukrainian: $(ls docs/ua/*.md 2>/dev/null | wc -l | tr -d ' ')"
      echo "Portuguese: $(ls docs/pt/*.md 2>/dev/null | wc -l | tr -d ' ')"
      echo '=== Missing Translations ==='
      for lang in es ua pt; do
        for file in docs/en/*.md; do
          target="docs/$lang/$(basename "$file")"
          [ -f "$target" ] || echo "Missing: $target"
        done
      done
      ;;
    preen-window-consistency)
      rg -n --glob '*.tsx' 'lastRefreshTokenRef|lastRefreshToken' packages | rg -v 'window-manager' | head -20
      rg -n --glob '*.tsx' 'dragOverId.*useState|setDragOver.*Id' packages | rg -v 'window-manager' | head -20
      rg -n --glob '*.tsx' 'cursor-col-resize.*onMouseDown|handleResize.*MouseEvent' packages | rg -v 'window-manager' | head -20
      ;;
    preen-file-limits)
      ./scripts/preen/checkFileLimits.sh --all 2>&1 | head -40
      ;;
    preen-knip)
      pnpm exec knip --config knip.json --use-tsconfig-files --reporter compact | head -80 || true
      ;;
  esac
}

metric_count() {
  case "$1" in
    preen-typescript)
      rg -n --glob '*.{ts,tsx}' ': any|: any\[\]|<any>|as any|@ts-ignore|@ts-expect-error' . | wc -l
      ;;
    preen-split-react-components)
      find . -name '*.tsx' -not -path '*/node_modules/*' -not -path '*/.next/*' -not -path '*/dist/*' -exec wc -l {} \; 2>/dev/null | awk '$1 > 300' | wc -l
      ;;
    preen-deferred-fixes)
      REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)
      gh issue list -R "$REPO" --label 'deferred' --state open --json number --jq 'length' 2>/dev/null || echo 0
      ;;
    preen-optimize-test-execution)
      pnpm exec tsx scripts/ciImpact/ciImpact.ts --base origin/main --head HEAD 2>/dev/null | jq '.warnings | length' 2>/dev/null || echo 0
      ;;
    preen-database-performance)
      rg -n --multiline --multiline-dotall --glob '*.{ts,tsx}' 'for\s*\([^)]*\)\s*\{.{0,400}?await\s+[^\n;]*db\.(select|query|execute)' packages | wc -l
      ;;
    preen-api-security)
      rg -L --glob '*.ts' 'authClaims|req\.session' packages/api/src/routes | rg -v 'index\.ts|shared\.ts|test\.' | wc -l
      ;;
    preen-dependency-security)
      pnpm audit --prod --audit-level high --json 2>/dev/null | jq '[.. | objects | .severity? // empty | select(. == "high" or . == "critical")] | length' 2>/dev/null || echo 0
      ;;
    preen-test-flakiness)
      rg -n --glob '**/*.{test,spec}.{ts,tsx}' 'setTimeout\(|waitForTimeout\(|sleep\(|retry|retries|flaky|TODO.*flaky' packages . | wc -l
      ;;
    preen-msw-parity)
      ./scripts/preen/checkMswParity.ts --json | jq '.missingRouteCount + .lowConfidenceRouteCount'
      ;;
    preen-skill-tooling)
      ./scripts/checkPreenEcosystem.sh --count-issues
      ;;
    preen-skill-parity)
      ./scripts/checkSkillParity.sh --count-issues
      ;;
    preen-compliance-docs)
      gaps=0
      for fw in HIPAA NIST.SP.800-53 SOC2; do
        while read -r policy_file; do
          policy=$(basename "$policy_file" -policy.md)
          [ ! -f "compliance/$fw/procedures/${policy}-procedure.md" ] && gaps=$((gaps + 1))
          [ ! -f "compliance/$fw/technical-controls/${policy}-control-map.md" ] && gaps=$((gaps + 1))
        done < <(find "compliance/$fw/policies" -name '*-policy.md' -type f 2>/dev/null)
      done
      unnumbered=$(find compliance -name '*.md' -not -name 'POLICY_INDEX.md' -not -name 'AGENTS.md' | xargs -I{} basename {} | grep -v '^[0-9][0-9]-' | wc -l)
      echo $((gaps + unnumbered))
      ;;
    preen-package-docs)
      count=0
      for pkg in packages/*/; do
        [ ! -f "${pkg}README.md" ] && count=$((count + 1))
      done
      echo $count
      ;;
    preen-review-instructions)
      GAPS=0
      for section in 'TypeScript Standards' 'API Security' 'React Standards' 'Database Performance' 'Testing Standards'; do
        [ -z "$(rg --fixed-strings -- "$section" REVIEW.md 2>/dev/null)" ] && GAPS=$((GAPS + 1))
      done
      REVIEW_SECTIONS=$(rg '^## ' REVIEW.md 2>/dev/null | wc -l | tr -d ' ')
      GEMINI_SECTIONS=$(rg '^## ' .gemini/INSTRUCTIONS.md 2>/dev/null | wc -l | tr -d ' ')
      [ "$GEMINI_SECTIONS" -lt $((REVIEW_SECTIONS / 2)) ] && GAPS=$((GAPS + 1))
      echo $GAPS
      ;;
    preen-i18n)
      EN_KEYS=$(rg -o "^\s+\w+:" packages/client/src/i18n/translations/en.ts 2>/dev/null | wc -l | tr -d ' ')
      GAPS=0
      for lang in es ua pt; do
        LANG_KEYS=$(rg -o "^\s+\w+:" packages/client/src/i18n/translations/${lang}.ts 2>/dev/null | wc -l | tr -d ' ')
        [ "$LANG_KEYS" -lt "$EN_KEYS" ] && GAPS=$((GAPS + EN_KEYS - LANG_KEYS))
      done
      HARDCODED=$(rg -c --glob '*.tsx' '>\s*[A-Z][a-z]+(\s+[a-z]+)*\s*<' packages 2>/dev/null | rg -v 'test\.' | awk -F: '{sum+=$2} END {print sum+0}')
      echo $((GAPS + HARDCODED))
      ;;
    preen-docs-internationalization)
      EN_COUNT=$(ls docs/en/*.md 2>/dev/null | wc -l | tr -d ' ')
      GAPS=0
      for lang in es ua pt; do
        LANG_COUNT=$(ls docs/$lang/*.md 2>/dev/null | wc -l | tr -d ' ')
        [ "$LANG_COUNT" -lt "$EN_COUNT" ] && GAPS=$((GAPS + EN_COUNT - LANG_COUNT))
      done
      echo $GAPS
      ;;
    preen-window-consistency)
      MANUAL_REFRESH=$(rg -c --glob '*.tsx' 'lastRefreshTokenRef|lastRefreshToken' packages 2>/dev/null | rg -v 'window-manager' | awk -F: '{sum+=$NF} END {print sum+0}')
      MANUAL_DRAG=$(rg -c --glob '*.tsx' 'dragOverId.*useState|setDragOver.*Id' packages 2>/dev/null | rg -v 'window-manager' | awk -F: '{sum+=$NF} END {print sum+0}')
      MANUAL_RESIZE=$(rg -c --glob '*.tsx' 'cursor-col-resize.*onMouseDown|handleResize.*MouseEvent' packages 2>/dev/null | rg -v 'window-manager' | awk -F: '{sum+=$NF} END {print sum+0}')
      echo $((MANUAL_REFRESH + MANUAL_DRAG + MANUAL_RESIZE))
      ;;
    preen-file-limits)
      ./scripts/preen/checkFileLimits.sh --all 2>&1 | grep '^  - ' | wc -l
      ;;
    preen-knip)
      KNIP_JSON=$(mktemp)
      pnpm exec knip --config knip.json --use-tsconfig-files --reporter json > "$KNIP_JSON" 2>/dev/null || true
      jq '[
        .issues[]? |
        (.dependencies // []),
        (.devDependencies // []),
        (.unlisted // []),
        (.unresolved // []),
        (.exports // []),
        (.types // [])
      ] | flatten | length' "$KNIP_JSON" 2>/dev/null
      rm -f "$KNIP_JSON"
      ;;
    *)
      echo 0
      ;;
  esac
}

print_health_report() {
  if [ -f "$RUNS_FILE" ] && [ "$(wc -l < "$RUNS_FILE" 2>/dev/null)" -gt 5 ]; then
    echo "=== Preen Health Report ==="
    LAST_RUNS_JSON=$(jq -s 'group_by(.selected_category) | map({(.[0].selected_category): (last.timestamp)}) | add // {}' "$RUNS_FILE" 2>/dev/null)
    for cat in "${CATEGORIES[@]}"; do
      LAST=$(echo "$LAST_RUNS_JSON" | jq -r --arg c "$cat" '.[$c] // "never"')
      printf "  %-30s %s\n" "$cat:" "$LAST"
    done

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
      .[] | "  \\(.cat): \\(.rate)%"'
      "$RUNS_FILE" 2>/dev/null || true

    echo ""
    echo "Recommendations:"
    [ -n "$STALE_CATEGORIES" ] && echo "  - Review stale categories (0 changes in 10 runs): $STALE_CATEGORIES"
    [ -n "$UNDER_SERVED" ] && echo "  - Prioritize under-served categories: $UNDER_SERVED"

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
}

ensure_clean_worktree() {
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Working tree is not clean. Commit or stash changes before running preen." >&2
    exit 1
  fi
}

determine_default_branch() {
  local default_branch
  default_branch=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null || true)
  if [ -z "$default_branch" ]; then
    default_branch=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || true)
  fi
  if [ -z "$default_branch" ]; then
    default_branch="main"
  fi
  printf '%s' "$default_branch"
}

if [ "$PASSIVE" = true ] || [ "$DRY_RUN" = true ]; then
  echo "Passive/dry-run mode: skipping clean-worktree check"
else
  ensure_clean_worktree
fi

DEFAULT_BRANCH=$(determine_default_branch)
if [ "$PASSIVE" = true ] || [ "$DRY_RUN" = true ]; then
  echo "Passive/dry-run mode: skipping checkout/sync for $DEFAULT_BRANCH"
else
  echo "Checking out $DEFAULT_BRANCH"
  git fetch origin "$DEFAULT_BRANCH"
  git checkout "$DEFAULT_BRANCH"
  git pull --ff-only origin "$DEFAULT_BRANCH"
fi

analyze_history
print_health_report

for category in "${ACTIVE_CATEGORIES[@]}"; do
  printf '\n--- Discovery: %s ---\n' "$category"
  run_discovery "$category"
done

echo "### Next Steps"
echo "1. Select the highest-value candidate (score = severity*3 + blast_radius*2 + confidence*2 - effort)."
echo "2. Capture baseline: find the selected category in the \`metric_count\` function and run that command manually."
echo "3. Land ${MIN_FIXES}-${MAX_FIXES} fixes for this run (or fail the run if you cannot meet the minimum with high-confidence, behavior-safe changes)."
echo "4. Only create a branch and make changes when you're ready to sign off. Use PREEN_MODE aggressive/full/single/security/audit semantics."
echo "5. After editing, rerun \`runPreen.sh\` (or \`./scripts/agents/tooling/agentTool.ts runPreen\`) and verify coverage/impact, then commit with \`refactor(preen): stateful single-pass improvements\`."
echo "6. Push, open PR, and tag with \`./scripts/agents/tooling/agentTool.ts tagPrWithTuxedoInstance\`."
echo "7. Record the run in \`.git/preen/runs.jsonl\` as described in the script comments."

if [ "$DRY_RUN" = true ]; then
  echo "Dry-run complete. No changes were made."
elif [ "$PASSIVE" = true ]; then
  echo "Passive run complete. No workspace changes were made."
else
  echo "Preen discovery complete. Follow the next steps above."
fi
