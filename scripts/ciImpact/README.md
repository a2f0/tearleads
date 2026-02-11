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

## Safety Rules

- Prefer false positives over false negatives.
- Workflow changes trigger the full integration matrix.
- If diff base is unavailable, fallback diff is `HEAD~1...HEAD`.

## Maintenance

When CI topology changes, update both:

- `scripts/ciImpact/job-groups.json`
- workflow filters in `.github/workflows/build.yml`
