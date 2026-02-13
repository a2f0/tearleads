---
description: Stateful single-pass preening across all preen skills (project)
---

# Preen All

Perform a proactive, stateful pass through preen skills, implement focused improvements, open a PR, and enter the merge queue.

## When to Run

Run this meta-skill regularly for continuous quality improvement. It is intentionally iterative: default mode lands one meaningful fix per run and advances to the next category over time.

## Self-Update Check (CRITICAL)

Before running, verify skill parity and registry drift:

```bash
# Discover all preen skills
echo "=== Claude Code preen skills ==="
ls -1 .claude/commands/preen-*.md 2>/dev/null | sed 's|.claude/commands/||;s|\.md$||' | sort

echo "=== Codex preen skills ==="
ls -1d .codex/skills/preen-*/ 2>/dev/null | sed 's|.codex/skills/||;s|/$||' | sort

# Hard parity check
CLAUDE_SKILLS=$(ls -1 .claude/commands/preen-*.md 2>/dev/null | sed 's|.claude/commands/||;s|\.md$||' | sort)
CODEX_SKILLS=$(ls -1d .codex/skills/preen-*/ 2>/dev/null | sed 's|.codex/skills/||;s|/$||' | sort)

diff -u <(echo "$CLAUDE_SKILLS") <(echo "$CODEX_SKILLS")
```

If parity fails, STOP and update both:

1. `.claude/commands/preen.md`
2. `.codex/skills/preen/SKILL.md`

## Preen Skills Registry

| Skill | Purpose |
| ----- | ------- |
| `preen-typescript` | Fix weak TypeScript typings (`any`, `as` casts, `@ts-ignore`) |
| `preen-split-react-components` | Split oversized React components into smaller files |
| `preen-inefficient-resolution` | Fix cyclical imports and module resolution issues |
| `preen-deferred-fixes` | Complete deferred follow-ups from merged PR reviews |
| `preen-optimize-test-execution` | Tune CI impact analysis (workflow filters, package dependencies) |
| `preen-api-security` | Audit API auth boundaries, data access, and input validation |

## Run Modes

Use `PREEN_MODE` to control scope:

| Mode | Behavior |
| ---- | -------- |
| `single` (default) | Run exactly one rotating category and land at most one fix |
| `full` | Run all categories and land at most one fix per category |
| `security` | Run only `preen-api-security` and land at most one fix |

## Stateful Iteration (CRITICAL)

Persist rotation state locally so repeated runs naturally cover the full quality surface.

```bash
MODE="${PREEN_MODE:-single}"
STATE_DIR=".git/preen"
CURSOR_FILE="$STATE_DIR/cursor"
HISTORY_FILE="$STATE_DIR/history.log"

CATEGORIES=(
  "preen-typescript"
  "preen-split-react-components"
  "preen-inefficient-resolution"
  "preen-deferred-fixes"
  "preen-optimize-test-execution"
  "preen-api-security"
)

mkdir -p "$STATE_DIR"
[ -f "$CURSOR_FILE" ] || echo 0 > "$CURSOR_FILE"
CURSOR=$(cat "$CURSOR_FILE")

case "$MODE" in
  single)
    ACTIVE_CATEGORIES=("${CATEGORIES[$CURSOR]}")
    NEXT_CURSOR=$(( (CURSOR + 1) % ${#CATEGORIES[@]} ))
    ;;
  full)
    ACTIVE_CATEGORIES=("${CATEGORIES[@]}")
    NEXT_CURSOR="$CURSOR"
    ;;
  security)
    ACTIVE_CATEGORIES=("preen-api-security")
    NEXT_CURSOR="$CURSOR"
    ;;
  *)
    echo "Unknown PREEN_MODE: $MODE"
    exit 1
    ;;
esac

printf 'mode=%s active=%s\n' "$MODE" "${ACTIVE_CATEGORIES[*]}"
```

## Workflow

### 1. Setup

```bash
git checkout main
git pull origin main

BRANCH="refactor/preen-$(date +%Y%m%d-%H%M%S)"
git checkout -b "$BRANCH"
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
      find . -name "*.tsx" -not -path "*/node_modules/*" -not -path "*/.next/*" -not -path "*/dist/*" -exec wc -l {} \; 2>/dev/null | awk '$1 > 300' | sort -rn | head -20
      ;;
    preen-inefficient-resolution)
      npx madge --circular --extensions ts,tsx packages/ 2>/dev/null | head -20 || true
      rg -n --glob '*.{ts,tsx}' "from '\.\./\.\./\.\./\.\." . | head -20
      ;;
    preen-deferred-fixes)
      REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)
      gh issue list -R "$REPO" --label "deferred" --state open --limit 20 2>/dev/null || true
      ;;
    preen-optimize-test-execution)
      pnpm exec tsx scripts/ciImpact/ciImpact.ts --base origin/main --head HEAD | head -40
      ;;
    preen-api-security)
      rg -n --glob '*.ts' "router\\.(get|post|put|patch|delete)|authClaims|req\\.session|pool\\.query|client\\.query" packages/api/src/routes | head -40
      ;;
  esac
}

for category in "${ACTIVE_CATEGORIES[@]}"; do
  run_discovery "$category"
done
```

### 3. Selection and Fix Limits

For each active category, select the highest-value candidate with this rubric:

`score = (severity * 3) + (blast_radius * 2) + (confidence * 2) - effort`

Fix limits:

- `single`: maximum 1 total fix in the run
- `full`: maximum 1 fix per active category
- `security`: maximum 1 security fix

Do not pick a candidate if confidence is low or behavior impact is unclear.

### 4. Implement Focused Fixes

Apply minimal, behavior-preserving changes and add/update tests where needed.

### 5. Validate

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

### 6. Quality Delta Gate

Before opening a PR, record measurable improvement. Example metrics:

- Type safety findings (`any`, unsafe casts, `@ts-ignore`)
- Circular imports / deep relative imports
- Oversized React files
- Deferred issue count
- API security findings in touched area

If no metric improves, do not open a PR.

### 7. Commit and Push

If changes were made:

```bash
git add -A
git commit -S -m "refactor(preen): stateful single-pass improvements" >/dev/null
git push -u origin "$BRANCH" >/dev/null
```

### 8. Open PR and Enter Merge Queue

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

gh pr create --repo "$REPO" --title "refactor(preen): stateful single-pass improvements" --body "$(cat <<'PR_BODY'
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

## Quality Delta
- [ ] Baseline metrics captured
- [ ] Post-change metrics captured
- [ ] At least one metric improved

## Test Plan
- [x] Impacted quality checks pass
- [x] Impacted coverage checks pass
- [x] Additional full checks run when needed
PR_BODY
)"

/enter-merge-queue
```

### 9. Update Rotation State

Always persist cursor and run history after evaluation (with or without code changes):

```bash
echo "$NEXT_CURSOR" > "$CURSOR_FILE"
printf '%s\t%s\t%s\t%s\n' \
  "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  "$MODE" \
  "${ACTIVE_CATEGORIES[*]}" \
  "completed" >> "$HISTORY_FILE"
```

### 10. No Changes Case

If no high-value candidate is found:

- Do not create a PR
- Still advance cursor in `single` mode
- Report the scanned category and next category in rotation

## Single-Pass Philosophy

Default `single` mode keeps PRs reviewable and low-risk by landing one meaningful improvement at a time. Repeated runs provide broad coverage via cursor rotation.

## Guardrails

- In `single` mode, do not land more than one fix total
- In `full` mode, do not land more than one fix per category
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
