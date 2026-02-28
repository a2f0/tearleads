# VFS Share Policy Rollout Gates (v1)

Status: active test gate for issue #2412 (child of #2400).

This document defines the minimum correctness and performance gates required
before shipping share-policy compiler changes.

## Correctness gates

The following test suites must stay green:

- `packages/api/src/lib/vfsSharePolicyCompilerCore.test.ts`
- `packages/api/src/lib/vfsSharePolicyCompilerCore.containerRoots.test.ts`
- `packages/api/src/lib/vfsSharePolicyCompiler.test.ts`
- `packages/api/src/lib/vfsSharePolicyRecompute.test.ts`
- `packages/api/src/lib/vfsSharePolicyPreviewTree.test.ts`
- `packages/api/src/lib/vfsSharePolicyRolloutDeterminism.test.ts`
- `packages/api/src/routes/vfs-shares/getSharePoliciesPreview.test.ts`
- `packages/vfs-explorer/src/hooks/useSharePolicyPreview.test.tsx`

These suites cover deny-wins precedence, container-root validation, scoped
recompute, preview tree state classification, deterministic compilation, and
deep-tree UI pagination behavior.

## Performance budgets

Policy engine changes are blocked when either budget test fails.

1. Core compile fanout budget
Test: `packages/api/src/lib/vfsSharePolicyRolloutPerformance.test.ts`
Case: single active container policy, 6,000 descendants, subtree include.
Threshold: runtime must be `< 900ms`.

2. Preview projection budget
Test: `packages/api/src/lib/vfsSharePolicyRolloutPerformance.test.ts`
Case: preview page size 1,500 nodes with direct/derived/denied classification.
Threshold: runtime must be `< 700ms`.

Budgets are guardrails, not service-level objectives. If a legitimate feature
requires new complexity, update this document and the test thresholds in the
same pull request.

## CI wiring

- CI runs package test coverage for impacted packages via
  `.github/workflows/build.yml`.
- For `@tearleads/api` and `@tearleads/vfs-explorer`, that executes all Vitest
  suites above, including rollout determinism and performance tests.
- Failures in these suites fail the build job and block merge.
