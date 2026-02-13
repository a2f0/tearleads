---
name: preen
description: Single-pass preening across all preen skills - fixes issues, opens PR, enters merge queue. Run regularly for continuous code quality improvement.
---

# Preen All

Perform a single proactive pass through all preen skills, fix issues found, open a PR, and enter the merge queue.

## When to Run

Run this meta-skill regularly for continuous code quality improvement. It executes all preen skills in sequence, batches fixes into a single PR, and ships it.

## Self-Update Check (CRITICAL)

Before running, verify this skill is up-to-date:

```bash
# Discover all preen skills
echo "=== Claude Code preen skills ==="
ls -1 .claude/commands/preen-*.md 2>/dev/null | sed 's|.claude/commands/||;s|\.md$||' | sort

echo "=== Codex preen skills ==="
ls -1d .codex/skills/preen-*/ 2>/dev/null | sed 's|.codex/skills/||;s|/$||' | sort
```

If you discover preen skills not in the registry below, STOP and:

1. Update this file's registry
2. Update `.claude/commands/preen.md` registry
3. Commit updates before proceeding

## Preen Skills Registry

| Skill | Purpose |
| ----- | ------- |
| `preen-api-security` | Audit API for authorization, data access, and security issues |
| `preen-typescript` | Fix weak TypeScript typings (`any`, `as` casts, `@ts-ignore`) |
| `preen-split-react-components` | Split oversized React components into smaller files |
| `preen-inefficient-resolution` | Fix cyclical imports and module resolution issues |
| `preen-deferred-fixes` | Complete deferred follow-ups from merged PR reviews |
| `preen-optimize-test-execution` | Tune CI impact analysis (workflow filters, package dependencies) |

## Workflow

### 1. Setup

```bash
# Ensure clean state
git checkout main
git pull origin main

# Create preen branch
BRANCH="refactor/preen-$(date +%Y%m%d-%H%M%S)"
git checkout -b "$BRANCH"
```

### 2. TypeScript Types Pass

Run discovery and fix ONE high-value issue:

```bash
# Find files with type issues
grep -rl --include="*.ts" --include="*.tsx" --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist ": any\|: any\[\]\|<any>\|as any" . 2>/dev/null | head -5
```

If issues found:

- Pick the highest-impact file (exported types > function signatures > local variables)
- Apply fix using proper typing, generics, or type guards
- Do NOT fix everything - fix ONE meaningful issue per category

### 3. React Components Pass

Run discovery and fix ONE high-value issue:

```bash
# Find large component files
find . -name "*.tsx" -not -path "*/node_modules/*" -not -path "*/.next/*" -not -path "*/dist/*" -exec wc -l {} \; 2>/dev/null | awk '$1 > 300' | sort -rn | head -5
```

If issues found:

- Pick the largest file with clear extraction boundaries
- Extract ONE self-contained component
- Create colocated test if needed

### 4. Module Resolution Pass

Run discovery and fix ONE high-value issue:

```bash
# Check for cyclical imports
npx madge --circular --extensions ts,tsx packages/ 2>/dev/null | head -5 || true

# Find deep relative imports
grep -r --include="*.ts" --include="*.tsx" --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist "from '\.\./\.\./\.\./\.\." . 2>/dev/null | head -5
```

If issues found:

- Fix ONE cycle or deep import
- Use path aliases or restructure module boundaries

### 5. Deferred Fixes Pass

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)
gh issue list -R "$REPO" --label "deferred" --state open --limit 3 2>/dev/null || true
```

If deferred issues exist:

- Pick ONE deferred item from the oldest issue
- Implement the fix with tests

### 6. Validate

```bash
pnpm typecheck >/dev/null
pnpm lint >/dev/null
pnpm test >/dev/null
```

On failure, fix issues before proceeding.

### 7. Commit and Push

If any changes were made:

```bash
git add -A
git commit -S -m "refactor: single-pass preen improvements" >/dev/null
git push -u origin "$BRANCH" >/dev/null
```

### 8. Open PR and Enter Merge Queue

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

# Create PR
gh pr create --repo "$REPO" --title "refactor: single-pass preen improvements" --body "$(cat <<'EOF'
## Summary
- Automated single-pass preen run across all code quality categories

## Changes
<!-- List specific fixes made in each category -->

## Categories Checked
- [ ] TypeScript types (`any`, `as` casts, `@ts-ignore`)
- [ ] React component splitting
- [ ] Module resolution (cycles, deep imports)
- [ ] Deferred fixes from PR reviews

## Test Plan
- [x] `pnpm typecheck` passes
- [x] `pnpm lint` passes
- [x] `pnpm test` passes
EOF
)"

# Enter merge queue
$enter-merge-queue
```

### 9. No Changes Case

If no issues were found in any category, report:

```text
No preen opportunities found. Codebase is clean across all categories:
- TypeScript types: No `any`, unsafe casts, or @ts-ignore
- React components: No oversized files needing splits
- Module resolution: No cycles or deep imports
- Deferred fixes: No open deferred issues
```

Do NOT create a branch or PR if no changes were made.

## Single-Pass Philosophy

Each preen run fixes ONE issue per category (max 4 fixes total). This keeps PRs small, reviewable, and low-risk. Run `$preen` regularly for continuous improvement rather than large batch fixes.

## Guardrails

- Do NOT fix multiple issues in the same category
- Do NOT change runtime behavior unless fixing a bug
- Do NOT introduce new `any`, `as`, or `@ts-ignore`
- Do NOT create empty PRs
- Keep each fix focused and independently verifiable

## Token Efficiency

```bash
# Suppress verbose output
pnpm typecheck >/dev/null
pnpm lint >/dev/null
pnpm test >/dev/null
git commit -S -m "message" >/dev/null
git push >/dev/null
```

On failure, re-run without suppression to debug.
