# CI Impact Analyzer

Dependency-aware CI job selection for PR changes.

## Purpose

This tool maps changed files to workspace packages, expands transitive dependents, and recommends which CI jobs to run. It is designed to reduce unnecessary test execution while remaining conservative when confidence is low.

## Usage

Analyze the current branch diff against `origin/main`:

```bash
pnpm exec tsx scripts/ciImpact/ciImpact.ts --base origin/main --head HEAD
```

Simulate with specific files:

```bash
pnpm exec tsx scripts/ciImpact/ciImpact.ts --files "tuxedo/tests/run.sh,packages/shared/src/index.ts"
```

Run impacted pre-push coverage selection:

```bash
pnpm exec tsx scripts/ciImpact/runImpactedTests.ts --base origin/main --head HEAD
```

Dry-run package selection:

```bash
pnpm exec tsx scripts/ciImpact/runImpactedTests.ts --files "packages/shared/src/index.ts" --dry-run
```

Run impacted quality checks (lint, type-check, build):

```bash
pnpm exec tsx scripts/ciImpact/runImpactedQuality.ts --base origin/main --head HEAD
```

Dry-run quality selection:

```bash
pnpm exec tsx scripts/ciImpact/runImpactedQuality.ts --files "packages/shared/src/index.ts" --dry-run
```

Derive required GitHub workflow names from ciImpact output (used by `CI Gate`):

```bash
pnpm exec tsx scripts/ciImpact/requiredWorkflows.ts --base origin/main --head HEAD
```

Validate workflow mapping drift (job keys/workflow names/CI Gate wiring):

```bash
pnpm exec tsx scripts/ciImpact/checkWorkflowDrift.ts
```

Sample recent merged PRs and compare predicted required workflows to observed workflow runs:

```bash
pnpm exec tsx scripts/ciImpact/validateRecentDecisions.ts --repo a2f0/tearleads --sample-size 30 --lookback-hours 24
```

Baseline script coverage for the ciImpact/required-workflow decision path:

```bash
pnpm dlx c8 --reporter=text-summary node --import tsx --test scripts/ciImpact/ciImpact.test.ts scripts/ciImpact/requiredWorkflows.test.ts
```

## Inputs

- `scripts/ciImpact/job-groups.json`: job groups and path policy
- `packages/*/package.json`: workspace package graph
- `git diff --name-only <base>...<head>`: changed files

## Output

JSON with:

- `changedFiles`
- `changedPackages`
- `affectedPackages`
- `jobs.<job>.run`
- `jobs.<job>.reasons`
- `warnings`

`runImpactedTests.ts` prints selected coverage targets and executes:

- `pnpm --filter <pkg> test:coverage`

`runImpactedQuality.ts` runs:

- selective `biome check` on changed files
- conditional `lint:scripts`, `lint:md`, `lint:rubocop`, `lint:ansible` by file scope
- selective per-package TypeScript checks
- selective per-package builds
- full legacy quality pipeline on high-risk config/workflow changes

`requiredWorkflows.ts` maps `jobs.<job>.run` decisions to concrete workflow names
and emits:

- `requiredWorkflows`
- `reasons` keyed by workflow name

## Safety Rules

- Prefer false positives over false negatives.
- Workflow changes trigger the full integration matrix.
- If diff base is unavailable, fallback diff is `HEAD~1...HEAD`.

## Maintenance

When CI topology changes, update both:

- `scripts/ciImpact/job-groups.json`
- workflow filters in `.github/workflows/build.yml`
