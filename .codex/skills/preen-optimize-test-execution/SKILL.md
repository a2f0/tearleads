---
name: preen-optimize-test-execution
description: Tune CI impact analysis by keeping workflow filters aligned with package dependencies.
---

# Optimize Test Execution

Use this skill to understand, debug, or tune the CI impact analysis system.

## When to Use

- Debugging why a CI job ran or was skipped
- Tuning which jobs run for specific file patterns
- Understanding why pre-push hooks ran full checks vs selective
- Keeping workflow filters aligned with package dependencies

## System Overview

The impact system operates at two levels:

| Level | Script | Trigger | Purpose |
| ----- | ------ | ------- | ------- |
| CI | `ciImpact.ts` | GitHub Actions workflows | Gate E2E/mobile/deploy jobs |
| Local | `runImpactedQuality.ts` | Pre-push hook | Selective lint/typecheck/build |
| Local | `runImpactedTests.ts` | Pre-push hook | Selective coverage tests |

## Scripts

### `scripts/ciImpact/ciImpact.ts`

Core analyzer that determines which CI jobs should run. Used by both GitHub Actions and local scripts.

```bash
# Analyze current branch vs main
pnpm exec tsx scripts/ciImpact/ciImpact.ts --base origin/main --head HEAD

# Simulate specific file changes (for tuning)
pnpm exec tsx scripts/ciImpact/ciImpact.ts \
  --files "packages/client/src/App.tsx,packages/api/src/index.ts"
```

**Output JSON includes:**

- `changedFiles` - Files modified in the diff
- `materialFiles` - Changed files minus ignored (docs, config-only)
- `changedPackages` - Packages with direct file changes
- `affectedPackages` - Packages affected transitively (dependents)
- `jobs` - Per-job `{ run: boolean, reasons: string[] }`
- `warnings` - Classification uncertainties

### `scripts/ciImpact/runImpactedQuality.ts`

Pre-push hook for selective quality checks. Runs biome, tsc, and build only for impacted packages.

```bash
# Normal run (invoked by husky pre-push)
pnpm exec tsx scripts/ciImpact/runImpactedQuality.ts

# Dry run to see what would execute
pnpm exec tsx scripts/ciImpact/runImpactedQuality.ts --dry-run
```

### `scripts/ciImpact/runImpactedTests.ts`

Pre-push hook for selective coverage tests. Only runs `test:coverage` for impacted packages.

```bash
# Normal run (invoked by husky pre-push)
pnpm exec tsx scripts/ciImpact/runImpactedTests.ts

# Dry run to see what would execute
pnpm exec tsx scripts/ciImpact/runImpactedTests.ts --dry-run
```

## Configuration

### `scripts/ciImpact/job-groups.json`

Central config for the impact analyzer:

- `ignoredPrefixes` - Paths that don't trigger jobs (e.g., `.claude/`, `docs/`)
- `ignoredExact` - Exact files to ignore (e.g., `LICENSE`)
- `ignoredSuffixes` - File extensions to ignore (e.g., `.md`)
- `workflowCriticalPrefixes` - Paths that trigger full CI matrix (e.g., `.github/workflows/`)
- `clientRuntimePackages` - Packages that affect all client platforms
- `jobNames` - CI jobs managed by the system

## Full Run Triggers

These file patterns trigger a **full run** of all checks (no selective optimization):

| Pattern | Rationale |
| ------- | --------- |
| `.github/workflows/*` | CI config changes need full validation |
| `.github/actions/*` | Shared action changes affect all jobs |
| `scripts/ciImpact/*` | Impact system changes need full validation |
| `package.json` | Dependency changes affect everything |
| `pnpm-lock.yaml` | Lock file changes affect everything |
| `pnpm-workspace.yaml` | Workspace config affects all packages |
| `tsconfig.json` | Root TS config affects all packages |
| `biome.json` / `biome.jsonc` | Linter config affects all packages |

## Safety Model

- **Prefer false positives over false negatives** - Better to run extra jobs than miss a failure
- **Workflow/config changes run full matrix** - Conservative when CI infrastructure changes
- **Uncertain classification runs more jobs** - When in doubt, test it

## Workflow Integration

### GitHub Actions

Each gated workflow has a `detect-impact` job that runs `ciImpact.ts` and sets output variables:

```yaml
jobs:
  detect-impact:
    outputs:
      should-run: ${{ steps.impact.outputs.should-run }}
    steps:
      - run: tsx scripts/ciImpact/ciImpact.ts --base "$BASE" --head "$HEAD" > ci-impact.json
      - run: echo "should-run=$(jq -r '.jobs["web-e2e"].run' ci-impact.json)" >> "$GITHUB_OUTPUT"

  web-e2e:
    needs: detect-impact
    if: ${{ github.event_name == 'workflow_dispatch' || needs.detect-impact.outputs.should-run == 'true' }}
```

### Local Pre-Push

The husky pre-push hook runs both local scripts before allowing push:

1. `runImpactedQuality.ts` - Lint, typecheck, build
2. `runImpactedTests.ts` - Coverage tests

## Tuning the System

### Adding a new ignored path

Edit `job-groups.json`:

```json
{
  "ignoredPrefixes": [
    ".claude/",
    "docs/",
    "your-new-path/"
  ]
}
```

### Testing rule changes

```bash
# Verify tuxedo-only changes don't trigger client jobs
pnpm exec tsx scripts/ciImpact/ciImpact.ts --files "tuxedo/tests/run.sh"

# Verify shared package changes trigger all client jobs
pnpm exec tsx scripts/ciImpact/ciImpact.ts --files "packages/shared/src/index.ts"

# Verify website changes only trigger website jobs
pnpm exec tsx scripts/ciImpact/ciImpact.ts --files "packages/website/src/pages/index.astro"
```

## Files to Keep in Sync

When modifying the impact system, update together:

- `scripts/ciImpact/job-groups.json` - Central config
- `scripts/ciImpact/ciImpact.ts` - Job decision logic
- `scripts/ciImpact/runImpactedQuality.ts` - `FULL_RUN_PREFIXES` array
- `scripts/ciImpact/runImpactedTests.ts` - `FULL_RUN_PREFIXES` array
- `.github/workflows/*.yml` - Workflow gating conditions

## Token Efficiency

Use `--dry-run` mode for debugging without executing commands:

```bash
# Preview what would run (no actual execution)
pnpm exec tsx scripts/ciImpact/runImpactedQuality.ts --dry-run
pnpm exec tsx scripts/ciImpact/runImpactedTests.ts --dry-run
```

Suppress verbose output when only exit codes matter:

```bash
# Suppress validation output
pnpm lint >/dev/null
pnpm typecheck >/dev/null
pnpm test >/dev/null

# Suppress git operations
git commit -S -m "message" >/dev/null
git push >/dev/null
```

On failure, re-run without suppression to debug.
