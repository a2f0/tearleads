---
name: preen-database-performance
description: Proactively find and fix database performance issues (N+1 queries, inefficient joins, index gaps) with real-db regression tests.
---


# Preen Database Performance

Proactively reduce database latency and query volume by finding N+1 patterns, join inefficiencies, and missing indexes in query-heavy paths.

## When to Run

Run this skill when:

- Preen rotation selects `preen-database-performance`
- API or feature paths feel slow under realistic data volume
- Review feedback flags N+1 queries or expensive joins
- Query-heavy code changed without a real-database regression test

## Discovery Phase

Start by finding likely hotspots and existing real-db tests you can extend:

```bash
# N+1 pattern: query calls inside loops
rg -n --multiline --multiline-dotall --glob '*.{ts,tsx}' 'for\s*\([^)]*\)\s*\{.{0,400}?await\s+[^\n;]*db\.(select|query|execute)' packages | head -40 || true

# Join-heavy query builders to inspect for poor predicates/index coverage
rg -n --glob '*.{ts,tsx}' '\.(leftJoin|innerJoin|rightJoin|fullJoin|crossJoin)\(' packages | head -40 || true

# Real-database tests available for extension
rg -n --glob '**/*.{test,spec}.{ts,tsx}' 'withRealDatabase\(|createTestDatabase\(' packages | head -40 || true
```

## Target Selection

Pick one high-value query path with all of these:

- Clear user-facing impact (slow list/load/search path)
- Reproducible with seeded realistic data
- Fix can be shipped in one focused PR

Avoid broad multi-query rewrites in one run.

## Real-DB Regression Workflow (CRITICAL)

Use `@tearleads/db-test-utils` and real migrations for the affected domain. Do not use mocked adapters for performance validation.

### 1. Build a Repro Test with Realistic Cardinality

- Use `withRealDatabase` or `createTestDatabase`.
- Seed realistic data shape and volume (enough rows to expose the issue).
- Measure both query count and elapsed time around the target operation.

```typescript
import { withRealDatabase } from '@tearleads/db-test-utils';
import { migrations } from '@/db/migrations';

type PerfStats = { queryCount: number; durationMs: number };

const measurePerf = async (
  adapter: { execute: (sql: string, params?: unknown[]) => Promise<unknown> },
  run: () => Promise<void>
): Promise<PerfStats> => {
  const originalExecute = adapter.execute.bind(adapter);
  let queryCount = 0;

  adapter.execute = async (sql, params) => {
    const trimmed = sql.trim().toUpperCase();
    if (
      trimmed.startsWith('SELECT') ||
      trimmed.startsWith('INSERT') ||
      trimmed.startsWith('UPDATE') ||
      trimmed.startsWith('DELETE')
    ) {
      queryCount += 1;
    }
    return originalExecute(sql, params);
  };

  const start = performance.now();
  try {
    await run();
  } finally {
    adapter.execute = originalExecute;
  }

  return { queryCount, durationMs: performance.now() - start };
};

it('optimizes playlist load query path', async () => {
  await withRealDatabase(
    async ({ db, adapter }) => {
      await seedRealisticPlaylistData(db, {
        playlists: 50,
        tracksPerPlaylist: 200
      });

      const before = await measurePerf(adapter, async () => {
        await loadPlaylistsWithTracks(db);
      });

      expect(before.queryCount).toBeGreaterThan(100);
    },
    { migrations }
  );
});
```

### 2. Confirm the Problem Exists

- Run the new test and capture measured `queryCount` and `durationMs`.
- Keep this as a local characterization step only; do not ship a final test that expects poor performance.

### 3. Implement the Fix

Prefer minimal, behavior-preserving changes such as:

- Replace per-row lookups with batched `IN (...)` queries
- Push filtering/aggregation into SQL instead of client-side loops
- Tighten joins and selected columns
- Add or adjust indexes when query plans show scans on large tables

### 4. Validate Query Plan for Join and Index Changes

Use SQLite plan inspection in the same real-db test when relevant:

```typescript
const plan = await adapter.execute('EXPLAIN QUERY PLAN SELECT ...');
```

Check for avoidable full table scans on large tables in the hotspot query.

### 5. Re-run and Convert to Regression Baseline

After the fix:

- Re-run the test and record improved metrics.
- Replace the temporary "problem exists" expectation with upper-bound baseline assertions.
- Keep the baseline tight but stable for CI noise.

```typescript
const baseline = { queryCount: 6, durationMs: 40 };
expect(after.queryCount).toBeLessThanOrEqual(baseline.queryCount);
expect(after.durationMs).toBeLessThanOrEqual(baseline.durationMs);
```

This is the committed state: real-db regression test plus improved baseline.

## Workflow

1. **Discovery**: Identify one query hotspot and one target test file.
2. **Characterize**: Add real-db performance test using `@tearleads/db-test-utils` and realistic seed data.
3. **Reproduce**: Run once to confirm the issue exists and capture pre-fix metrics.
4. **Fix**: Remove N+1 or inefficient join pattern with minimal behavior change.
5. **Baseline update**: Re-run, then update test expectations to the new post-fix baseline.
6. **Validate**: Run impacted tests and any directly affected suites.
7. **Commit and merge**: Run `/commit-and-push`, then `/enter-merge-queue`.

If no reproducible hotspot is found, do not create a branch.

## Validation Commands

```bash
# Run only the focused regression test while iterating
pnpm vitest run <path-to-performance-test>

# Then run impacted checks
pnpm exec tsx scripts/ciImpact/runImpactedQuality.ts >/dev/null
pnpm exec tsx scripts/ciImpact/runImpactedTests.ts >/dev/null
```

## Guardrails

- Use real database setup from `packages/db-test-utils`; no mock-only perf claims.
- Seed realistic cardinality; tiny fixtures hide N+1 behavior.
- Do not ship tests that assert degraded performance.
- Do not loosen new baseline thresholds to hide regressions.
- Keep fixes scoped to one hotspot per preen run.

## Quality Bar

- Real-db regression test exists for the optimized path
- Pre-fix issue was reproduced and measured locally
- Committed test asserts improved baseline (`after <= baseline`)
- Query count and/or runtime improved measurably
- Impacted checks pass

## Token Efficiency

```bash
rg -n --multiline --multiline-dotall --glob '*.{ts,tsx}' 'for\s*\([^)]*\)\s*\{.{0,400}?await\s+[^\n;]*db\.(select|query|execute)' packages | head -40 || true
rg -n --glob '*.{ts,tsx}' '\.(leftJoin|innerJoin|rightJoin|fullJoin|crossJoin)\(' packages | head -40 || true
pnpm vitest run <path-to-performance-test>
pnpm exec tsx scripts/ciImpact/runImpactedQuality.ts >/dev/null
pnpm exec tsx scripts/ciImpact/runImpactedTests.ts >/dev/null
git commit -S -m "message" >/dev/null
git push >/dev/null
```

On failure, rerun the failing command without suppression.
