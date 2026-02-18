---
name: preen-test-flakiness
description: Proactively identify and fix flaky test patterns (time-based waits, retries, races) with deterministic alternatives.
---

# Preen Test Flakiness

Proactively reduce flaky tests by removing nondeterministic waits, stabilizing async behavior, and tightening assertions so repeated runs produce the same result.

## When to Run

Run this skill when:

- Preen rotation selects `preen-test-flakiness`
- CI has intermittent test failures without code changes
- Suites rely on sleeps/timeouts/retries to pass
- Reviewers defer flake cleanup to a follow-up PR

## Discovery Phase

Focus on deterministic anti-patterns first:

```bash
# Time-based waiting patterns
rg -n --glob '**/*.{test,spec}.{ts,tsx}' 'setTimeout\(|waitForTimeout\(|sleep\(' packages . | head -40 || true

# Explicit flake markers / retries
rg -n --glob '**/*.{test,spec}.{ts,tsx}' 'retry|retries|flaky|TODO.*flaky|FIXME.*flaky' packages . | head -40 || true

# Non-deterministic sources used in tests
rg -n --glob '**/*.{test,spec}.{ts,tsx}' 'Math\.random|Date\.now|new Date\(|performance\.now' packages . | head -40 || true

# Snapshot overuse hotspots
rg -n --glob '**/*.{test,spec}.{ts,tsx}' 'toMatchSnapshot\(' packages . | head -30 || true
```

## Issue Categories

### 1. Time-Based Waits Instead of Condition-Based Waits

- `sleep` and fixed `setTimeout` waits are primary flake sources.
- Replace with event/condition-based waiting.
- Keep explicit timeout budgets only when tied to a real external constraint.

### 2. Retry-Masks

- Repeated retries can hide race conditions instead of fixing them.
- Prefer deterministic setup and stronger synchronization points.
- Keep retries as a temporary containment only with clear follow-up.

### 3. Async Race Conditions

- Missing `await`, orphaned promises, and late assertions create nondeterminism.
- Ensure async side effects complete before assertions.
- Isolate test state per test case.

### 4. Non-Deterministic Data Sources

- Unmocked clocks/randomness can cause intermittent failures.
- Use controlled clocks and deterministic seeds.
- Freeze or inject time where assertions depend on timestamps.

## Prioritization

Fix in this order:

1. Time-based waits in heavily exercised test suites
2. Retry masks hiding real races
3. Shared mutable state / missing await patterns
4. Snapshot overuse with unstable output

## Fix Patterns

### Replace Sleep with Condition Wait

```typescript
// Before
await new Promise((resolve) => setTimeout(resolve, 1000));
expect(await screen.findByText('Ready')).toBeVisible();

// After
await waitFor(() => {
  expect(screen.getByText('Ready')).toBeVisible();
});
```

### Stabilize Time

```typescript
vi.useFakeTimers();
vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
```

### Remove Retry Mask

- Replace implicit retries with explicit synchronization.
- Narrow assertions to the user-visible contract.
- Add focused setup helpers for deterministic state.

## Workflow

1. **Discovery**: Identify one high-value flake source.
2. **Select one fix**: Keep scope tight and behavior-preserving.
3. **Create branch**: `git checkout -b test/flake-<area>`
4. **Implement**: Replace nondeterministic pattern with deterministic logic.
5. **Validate**: Run impacted tests repeatedly for confidence.
6. **Document**: Record before/after flake-pattern count.
7. **Commit and merge**: Run `/commit-and-push`, then `/enter-merge-queue`.

If no high-value fix is found, do not create a branch.

## Validation Suggestions

Run targeted suites multiple times when possible:

```bash
pnpm exec tsx scripts/ciImpact/runImpactedTests.ts >/dev/null
pnpm exec tsx scripts/ciImpact/runImpactedQuality.ts >/dev/null
```

For suspicious suites, rerun directly in a loop with the smallest reliable command.

## Guardrails

- Do not expand scope into broad test rewrites in one preen run.
- Do not change production behavior to satisfy tests.
- Do not replace deterministic assertions with weaker ones.
- Do not reduce coverage thresholds.

## Quality Bar

- Flake-pattern count reduced for selected area
- Tests remain meaningful and deterministic
- Impacted checks pass
- Change is small and reviewable

## Token Efficiency

```bash
rg -n --glob '**/*.{test,spec}.{ts,tsx}' 'setTimeout\(|waitForTimeout\(|sleep\(' packages . | head -40 || true
rg -n --glob '**/*.{test,spec}.{ts,tsx}' 'retry|retries|flaky|TODO.*flaky|FIXME.*flaky' packages . | head -40 || true
pnpm exec tsx scripts/ciImpact/runImpactedTests.ts >/dev/null
pnpm exec tsx scripts/ciImpact/runImpactedQuality.ts >/dev/null
git commit -S -m "message" >/dev/null
git push >/dev/null
```

On failure, rerun the failing command without suppression.
