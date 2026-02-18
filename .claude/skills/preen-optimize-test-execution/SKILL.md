---
name: preen-optimize-test-execution
description: Tune CI impact analysis by keeping workflow filters aligned with package dependencies.
---

# Optimize Test Execution

Dependency-aware impact analysis system that decides which CI jobs and local checks should run based on changed files.

> **See also**: [`.github/AGENTS.md`](../../.github/AGENTS.md) for full CI architecture documentation including workflow relationships, version bump automation, and agent interaction guidelines.

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

**Preferred: Use the scriptTool wrapper:**

```bash
# Analyze current branch vs main
./scripts/tooling/scriptTool.ts ciImpact --base origin/main --head HEAD --json

# Run quality checks on impacted files
./scripts/tooling/scriptTool.ts runImpactedQuality --base origin/main --head HEAD

# Run tests on impacted packages
./scripts/tooling/scriptTool.ts runImpactedTests --base origin/main --head HEAD
```

<details>
<summary>Direct invocation (for tuning/debugging)</summary>

```bash
# Analyze current branch vs main
pnpm exec tsx scripts/ciImpact/ciImpact.ts --base origin/main --head HEAD

# Simulate specific file changes (for tuning)
pnpm exec tsx scripts/ciImpact/ciImpact.ts \
  --files "packages/client/src/App.tsx,packages/api/src/index.ts"
```

</details>

**Output JSON includes:**

- `changedFiles` - Files modified in the diff
- `materialFiles` - Changed files minus ignored (docs, config-only)
- `changedPackages` - Packages with direct file changes
- `affectedPackages` - Packages affected transitively (dependents)
- `jobs` - Per-job `{ run: boolean, reasons: string[] }`
- `warnings` - Classification uncertainties

### `scripts/ciImpact/runImpactedQuality.ts`

Pre-push hook for selective quality checks. Runs biome, tsc, and build only for impacted packages.

**Preferred: Use the scriptTool wrapper:**

```bash
./scripts/tooling/scriptTool.ts runImpactedQuality --base origin/main --head HEAD
```

<details>
<summary>Direct invocation (for pre-push hook)</summary>

```bash
# Normal run (invoked by husky pre-push)
pnpm exec tsx scripts/ciImpact/runImpactedQuality.ts

# Dry run to see what would execute
pnpm exec tsx scripts/ciImpact/runImpactedQuality.ts --dry-run
```

</details>

### `scripts/ciImpact/runImpactedTests.ts`

Pre-push hook for selective coverage tests. Only runs `test:coverage` for impacted packages.

**Preferred: Use the scriptTool wrapper:**

```bash
./scripts/tooling/scriptTool.ts runImpactedTests --base origin/main --head HEAD
```

<details>
<summary>Direct invocation (for pre-push hook)</summary>

```bash
# Normal run (invoked by husky pre-push)
pnpm exec tsx scripts/ciImpact/runImpactedTests.ts

# Dry run to see what would execute
pnpm exec tsx scripts/ciImpact/runImpactedTests.ts --dry-run
```

</details>

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

## When to Run This Skill

Run this preen skill after:

- Extracting code into a new package under `packages/`
- Adding a new dependency to `@tearleads/client`
- Modifying the impact analysis scripts (`scripts/ciImpact/`)
- Suspecting CI is skipping tests it shouldn't (false negatives)

## Detecting Missing Client Runtime Packages

Cross-reference `@tearleads/client`'s workspace dependencies against `clientRuntimePackages`:

```bash
# Get client's workspace dependencies (packages starting with @tearleads/)
CLIENT_DEPS=$(jq -r '
  [.dependencies, .devDependencies, .peerDependencies]
  | add
  | keys[]
  | select(startswith("@tearleads/"))
' packages/client/package.json | sort)

# Get configured client runtime packages
CONFIGURED=$(jq -r '.clientRuntimePackages[]' scripts/ciImpact/job-groups.json | sort)

# Find missing packages (in client deps but not in config)
comm -23 <(echo "$CLIENT_DEPS") <(echo "$CONFIGURED")
```

If this outputs any packages, they should be added to `clientRuntimePackages` in `job-groups.json`.

**Verify with simulation:**

```bash
# Test that a new package triggers client jobs
pnpm exec tsx scripts/ciImpact/ciImpact.ts --files "packages/<name>/src/index.ts"
```

Expected: `web-e2e`, `electron-e2e`, and mobile jobs should show `run: true`.

## Tuning the System

### Adding a new client runtime package

When a package is added as a dependency of `@tearleads/client`:

1. Add it to `clientRuntimePackages` in `job-groups.json`
2. Verify with: `pnpm exec tsx scripts/ciImpact/ciImpact.ts --files "packages/<name>/src/index.ts"`
3. Confirm `web-e2e`, `electron-e2e`, and mobile jobs show `run: true`

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

The `scriptTool.ts` wrappers already provide structured JSON output with `--json` flag. Prefer wrappers over direct invocation:

```bash
# Preferred - returns structured summary, suppresses verbose output
./scripts/tooling/scriptTool.ts ciImpact --base origin/main --head HEAD --json
./scripts/tooling/scriptTool.ts runImpactedQuality --base origin/main --head HEAD
./scripts/tooling/scriptTool.ts runImpactedTests --base origin/main --head HEAD
```

For debugging, use direct invocation without wrappers. Suppress git operations:

```bash
git commit -S -m "message" >/dev/null
git push >/dev/null
```

## Audit Checklist

When running this preen skill, verify the following:

1. **Client runtime packages are complete**: Run the detection script above. Any output indicates missing packages.

2. **New packages are discovered**: The system auto-discovers packages from `packages/` directory. Verify new packages have:
   - A `package.json` with a `name` field
   - Proper dependencies declared

3. **Transitive dependencies propagate**: Changes to a shared package should trigger dependents:

   ```bash
   # Verify shared triggers client
   pnpm exec tsx scripts/ciImpact/ciImpact.ts --files "packages/shared/src/index.ts" \
     | jq '.affectedPackages | contains(["@tearleads/client"])'
   ```

4. **Non-client packages don't over-trigger**: Changes to API-only or website-only packages shouldn't trigger mobile tests:

   ```bash
   # Verify website doesn't trigger mobile
   pnpm exec tsx scripts/ciImpact/ciImpact.ts --files "packages/website/src/pages/index.astro" \
     | jq '.jobs["android-maestro-release"].run'
   # Should output: false
   ```
