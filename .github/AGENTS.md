# CI System for Agents

This document describes the CI architecture and how agents should interact with it.

## Architecture Overview

```text
┌─────────────────────────────────────────────────────────────────┐
│                        Pull Request                              │
├──────────────┬──────────────┬───────────────────────────────────┤
│   CI Gate    │    build     │  Integration Workflows (on-demand)│
│  (gatekeeper)│   (core)     │  web-e2e, electron-e2e, mobile    │
└──────────────┴──────────────┴───────────────────────────────────┘
                      │
                      ▼ (merge to main)
┌─────────────────────────────────────────────────────────────────┐
│                   Main Version Bump                              │
│  (workflow_run trigger after successful build on main)           │
└─────────────────────────────────────────────────────────────────┘
                      │
                      ▼ (creates PR)
┌─────────────────────────────────────────────────────────────────┐
│                  Bump PR (ci/main-version-bump)                  │
│  CI runs → merge → deploy workflows trigger                      │
└─────────────────────────────────────────────────────────────────┘
```

## Core Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `build.yml` | push/PR | Lint, typecheck, build, unit tests |
| `ci-gate.yml` | PR events | Waits for required workflows based on impact analysis |
| `main-version-bump.yml` | workflow_run (after build on main) | Creates bump PR for version increments |
| `web-e2e.yml` | workflow_dispatch, PR | Playwright browser tests |
| `electron-e2e.yml` | workflow_dispatch, PR | Electron desktop tests |
| `android-maestro-release.yml` | workflow_dispatch, PR | Android Maestro tests |
| `ios-maestro-release.yml` | workflow_dispatch, PR | iOS Maestro tests |

## Impact Analysis System

The impact analyzer (`scripts/ciImpact/`) determines which CI jobs should run based on changed files. This reduces unnecessary test execution while remaining conservative.

### Key Scripts

| Script | Purpose |
|--------|---------|
| `ciImpact.ts` | Core analyzer - maps files to packages and jobs |
| `requiredWorkflows.ts` | Maps job decisions to workflow names for CI Gate |
| `runImpactedQuality.ts` | Pre-push hook for selective lint/typecheck/build |
| `runImpactedTests.ts` | Pre-push hook for selective coverage tests |
| `checkWorkflowDrift.ts` | Validates workflow mapping consistency |

### Configuration

Central config: `scripts/ciImpact/job-groups.json`

```json
{
  "ignoredPrefixes": [".claude/", "docs/"],      // Paths that don't trigger jobs
  "ignoredSuffixes": [".md"],                     // Extensions to ignore
  "workflowCriticalPrefixes": [".github/workflows/build.yml"],  // Trigger full matrix
  "clientRuntimePackages": ["@tearleads/client", ...],          // Affect client platforms
  "jobNames": ["build", "web-e2e", ...]                         // Managed job names
}
```

### How It Works

1. **Detect changed files** from git diff
2. **Map to packages** using workspace graph
3. **Expand dependents** transitively
4. **Decide jobs** based on affected packages
5. **CI Gate waits** for required workflows to complete

### Agent Usage

```bash
# Analyze impact of current changes
./scripts/tooling/scriptTool.ts ciImpact --base origin/main --head HEAD --json

# Run only impacted quality checks
./scripts/tooling/scriptTool.ts runImpactedQuality --base origin/main --head HEAD

# Run only impacted tests
./scripts/tooling/scriptTool.ts runImpactedTests --base origin/main --head HEAD
```

## Version Bump Workflow

The `main-version-bump.yml` workflow automatically creates version bump PRs after successful builds on main.

### Flow

1. **Trigger**: `workflow_run` event when `build` workflow completes on main
2. **Skip conditions**:
   - Source commit is already a bump commit (`chore(release): bump versions`)
   - Source commit was already processed (tracked via `source-sha:` in commit messages)
   - No package changes in the source commit
3. **Bump process**:
   - Checkout main
   - Fetch bump branch if exists, extract pending source SHAs
   - Order pending sources by main branch commit order
   - For each source SHA, run `bumpVersion.sh` on changed packages
   - Commit each bump with `source-sha:` and `source-run-id:` trailers
4. **PR management**:
   - Close existing bump PR (force-pushes don't trigger CI)
   - Create fresh PR (triggers `pull_request.opened` event)
   - Enable auto-merge

### Why Close/Recreate PR?

GitHub Actions force-pushes don't trigger `pull_request.synchronize` events (anti-loop protection). To ensure CI runs on updated bump branches, the workflow:

1. Closes the existing PR
2. Creates a new PR with the same content
3. The `opened` event triggers CI normally

### Commit Message Format

```text
chore(release): bump versions

source-sha: <original-commit-sha>
source-run-id: <github-run-id>
```

### Agent Interaction

The bump workflow is **fire-and-forget** for agents:

- Agents merge PRs normally to main
- Build workflow runs automatically
- On success, bump workflow triggers
- Bump PR is created with auto-merge enabled
- No agent intervention required

If a bump PR is stuck, agents can manually trigger the workflow:

```bash
gh workflow run main-version-bump.yml --ref main
```

## CI Gate

The `ci-gate.yml` workflow is a required status check that waits for all impacted workflows to complete.

### How CI Gate Works

1. **Detect required workflows** using `requiredWorkflows.ts`
2. **Poll workflow runs** every 20 seconds (max 85 minutes)
3. **Check conclusions**: fail fast on any failure, pass when all succeed

### Why CI Gate Exists

- Allows selective workflow execution (not all PRs need all tests)
- Provides single status check for branch protection
- Prevents PRs from merging before required workflows complete

## Full Run Triggers

These patterns trigger full CI matrix (all jobs run):

| Pattern | Rationale |
|---------|-----------|
| `.github/workflows/*` | CI config changes need full validation |
| `.github/actions/*` | Shared action changes affect all jobs |
| `scripts/ciImpact/*` | Impact system changes need validation |
| `package.json` (root) | Dependency changes affect everything |
| `pnpm-lock.yaml` | Lock file changes affect everything |
| `tsconfig.json` (root) | TypeScript config affects all packages |
| `biome.json` | Linter config affects all packages |

## Safety Model

The impact system prioritizes safety:

- **Prefer false positives over false negatives**: Better to run extra jobs than miss failures
- **Workflow changes run full matrix**: Conservative when CI infrastructure changes
- **Uncertain classification runs more jobs**: When in doubt, test it

## Agent Best Practices

### Before Pushing

```bash
# Run impacted quality checks locally
./scripts/tooling/scriptTool.ts runImpactedQuality --base origin/main --head HEAD

# Run impacted tests locally
./scripts/tooling/scriptTool.ts runImpactedTests --base origin/main --head HEAD
```

### Monitoring CI

```bash
# Check workflow status for current branch
BRANCH=$(git branch --show-current)
gh run list --branch "$BRANCH" --json name,status,conclusion --jq '.[] | "\(.name): \(.status) \(.conclusion // "")"'

# Watch specific workflow run
gh run watch <run-id>
```

### Debugging Failures

```bash
# View failed job logs
gh run view <run-id> --log-failed

# Re-run failed jobs
gh run rerun <run-id> --failed
```

### Simulating Impact

```bash
# Test what jobs would run for specific file changes
pnpm exec tsx scripts/ciImpact/ciImpact.ts --files "packages/client/src/App.tsx"
```

## Files to Keep in Sync

When modifying CI infrastructure, update together:

- `scripts/ciImpact/job-groups.json` - Central config
- `scripts/ciImpact/ciImpact.ts` - Job decision logic
- `scripts/ciImpact/workflowConfig.ts` - Workflow name mapping
- `scripts/ciImpact/runImpactedQuality.ts` - `FULL_RUN_PREFIXES` array
- `scripts/ciImpact/runImpactedTests.ts` - `FULL_RUN_PREFIXES` array
- `.github/workflows/*.yml` - Workflow gating conditions

## Related Skills

- `/preen-optimize-test-execution` - Audits impact analysis configuration
- `/enter-merge-queue` - Enables auto-merge and monitors PR to completion
- `/commit-and-push` - Commits with proper message format and pushes
