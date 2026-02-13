---
description: Stateful single-pass preening across all preen skills (project)
---

# Preen All

Perform a proactive, stateful pass through preen skills, implement focused improvements, open a PR, and enter the merge queue.

## When to Run

Run this meta-skill regularly for continuous quality improvement. It is intentionally iterative: default mode lands one meaningful fix per run and advances to the next category over time.

## Self-Update Check (CRITICAL)

Before running, verify skill parity, command syntax, and registry drift:

1. Run ecosystem checks:

```bash
./scripts/checkPreenEcosystem.sh --summary
```

2. Ensure top-level preen docs are generated from registry:

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
| `preen-typescript` | Fix weak TypeScript typings (`any`, `as` casts, `@ts-ignore`) |
| `preen-split-react-components` | Split oversized React components into smaller files |
| `preen-inefficient-resolution` | Fix cyclical imports and module resolution issues |
| `preen-deferred-fixes` | Complete deferred follow-ups from merged PR reviews |
| `preen-optimize-test-execution` | Tune CI impact analysis (workflow filters, package dependencies) |
| `preen-api-security` | Audit API for authorization, data access, and security issues |
| `preen-dependency-security` | Audit dependency vulnerabilities and unsafe versioning |
| `preen-test-flakiness` | Reduce flaky tests and nondeterministic waiting patterns |
| `preen-skill-tooling` | Validate skills are wired into agentTool.ts and scriptTool.ts |

## Run Modes

Use `PREEN_MODE` to control scope:

| Mode | Behavior |
| ---- | -------- |
| `single` (default) | Run exactly one rotating category and land at most one fix |
| `full` | Run all categories and land at most one fix per category |
| `security` | Run only security categories and land at most one fix |
| `audit` | Run discovery + scoring only; no edits, no branch, no PR |

## Stateful Iteration (CRITICAL)

Persist rotation state locally so repeated runs naturally cover the full quality surface.

```bash
MODE="${PREEN_MODE:-single}"
STATE_DIR=".git/preen"
CURSOR_FILE="$STATE_DIR/cursor"
RUNS_FILE="$STATE_DIR/runs.jsonl"

CATEGORIES=(
  "preen-typescript"
  "preen-split-react-components"
  "preen-inefficient-resolution"
  "preen-deferred-fixes"
  "preen-optimize-test-execution"
  "preen-api-security"
  "preen-dependency-security"
  "preen-test-flakiness"
  "preen-skill-tooling"
)

SECURITY_CATEGORIES=(
  "preen-api-security"
  "preen-dependency-security"
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
    preen-typescript)
      rg -n --glob '*.{ts,tsx}' ': any|: any\[\]|<any>|as any|@ts-ignore|@ts-expect-error' . | head -20
      ;;
    preen-split-react-components)
      find . -name '*.tsx' -not -path '*/node_modules/*' -not -path '*/.next/*' -not -path '*/dist/*' -exec wc -l {} \; 2>/dev/null | awk '$1 > 300' | sort -rn | head -20
      ;;
    preen-inefficient-resolution)
      npx madge --circular --extensions ts,tsx packages/ 2>/dev/null | head -20 || true
      rg -n --glob '*.{ts,tsx}' "from '\.\./\.\./\.\./\.\." . | head -20
      ;;
    preen-deferred-fixes)
      REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null); gh issue list -R "$REPO" --label 'deferred' --state open --limit 20 2>/dev/null || true
      ;;
    preen-optimize-test-execution)
      pnpm exec tsx scripts/ciImpact/ciImpact.ts --base origin/main --head HEAD | head -40
      ;;
    preen-api-security)
      rg -n --glob '*.ts' 'router\\.(get|post|put|patch|delete)|authClaims|req\\.session|pool\\.query|client\\.query' packages/api/src/routes | head -40
      ;;
    preen-dependency-security)
      pnpm audit --prod --audit-level high --json 2>/dev/null | head -40 || true
      rg -n --glob 'package.json' 'latest|next|canary|beta' packages scripts . | head -20 || true
      ;;
    preen-test-flakiness)
      rg -n --glob '**/*.{test,spec}.{ts,tsx}' 'setTimeout\\(|waitForTimeout\\(|sleep\\(' packages . | head -30 || true
      rg -n --glob '**/*.{test,spec}.{ts,tsx}' 'retry|retries|flaky|TODO.*flaky' packages . | head -30 || true
      ;;
    preen-skill-tooling)
      ./scripts/checkPreenEcosystem.sh --summary
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
    preen-inefficient-resolution)
      rg -n --glob '*.{ts,tsx}' "from '\.\./\.\./\.\./\.\." . | wc -l
      ;;
    preen-deferred-fixes)
      REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null); gh issue list -R "$REPO" --label 'deferred' --state open --json number --jq 'length' 2>/dev/null || echo 0
      ;;
    preen-optimize-test-execution)
      pnpm exec tsx scripts/ciImpact/ciImpact.ts --base origin/main --head HEAD 2>/dev/null | jq '.warnings | length' 2>/dev/null || echo 0
      ;;
    preen-api-security)
      rg -L --glob '*.ts' 'authClaims|req\\.session' packages/api/src/routes | rg -v 'index\\.ts|shared\\.ts|test\\.' | wc -l
      ;;
    preen-dependency-security)
      pnpm audit --prod --audit-level high --json 2>/dev/null | jq '[.. | objects | .severity? // empty | select(. == "high" or . == "critical")] | length' 2>/dev/null || echo 0
      ;;
    preen-test-flakiness)
      rg -n --glob '**/*.{test,spec}.{ts,tsx}' 'setTimeout\\(|waitForTimeout\\(|sleep\\(|retry|retries|flaky|TODO.*flaky' packages . | wc -l
      ;;
    preen-skill-tooling)
      ./scripts/checkPreenEcosystem.sh --count-issues
      ;;
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

- Type safety findings (`any`, unsafe casts, `@ts-ignore`)
- Oversized React files
- Circular imports / deep relative imports
- Deferred issue count
- CI impact warnings
- API security findings in touched area
- High/Critical dependency findings
- Flaky-pattern matches in tests
- Skill parity/tooling issues

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
- [ ] TypeScript types (`any`, `as` casts, `@ts-ignore`)
- [ ] React component splitting
- [ ] Module resolution (cycles, deep imports)
- [ ] Deferred fixes from PR reviews
- [ ] CI impact/test execution tuning
- [ ] API security boundaries
- [ ] Dependency/security hygiene
- [ ] Test flakiness hardening
- [ ] Skill tooling validation

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
/enter-merge-queue
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

## Single-Pass Philosophy

Default `single` mode keeps PRs reviewable and low-risk by landing one meaningful improvement at a time. Repeated runs provide broad coverage via cursor rotation.

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
