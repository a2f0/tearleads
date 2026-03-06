# Bun Migration Baseline (Phase 0)

Generated on 2026-03-06 (UTC) for issue [#2773](https://github.com/a2f0/tearleads/issues/2773).

## Reproducible Commands

```bash
# Runtime pilot averages (pnpm+vitest vs bunx+vitest)
BENCH_REPEATS=3 sh ./scripts/runBunRuntimePilot.sh all

# Broader single-pass benchmark (includes bun test node-only smoke)
BENCH_REPEATS=1 sh ./scripts/benchmarkBunMigration.sh

# CI stability snapshots (last 30 workflow runs)
gh run list --workflow build.yml --limit 30 --json conclusion,status
gh run list --workflow electron-e2e.yml --limit 30 --json conclusion,status
gh run list --workflow android-maestro-release.yml --limit 30 --json conclusion,status
gh run list --workflow ios-maestro-release.yml --limit 30 --json conclusion,status
```

## Local Runtime Pilot Baseline (`BENCH_REPEATS=3`)

| Suite | pnpm + vitest (s) | bunx + vitest (s) | Speedup |
| --- | ---: | ---: | ---: |
| node | 1.137 | 0.713 | 1.59x |
| ui | 1.610 | 1.132 | 1.42x |
| api/mock-heavy | 1.766 | 1.386 | 1.27x |

## Local Single-Pass Benchmark (`BENCH_REPEATS=1`)

| Scenario | Runtime | Wall clock (s) |
| --- | --- | ---: |
| node-only sample | pnpm + vitest | 1.03 |
| node-only sample | bunx + vitest | 0.68 |
| node-only sample | bun test | 0.27 |
| ui/jsdom sample | pnpm + vitest | 1.40 |
| ui/jsdom sample | bunx + vitest | 1.03 |
| api/mock-heavy sample | pnpm + vitest | 1.72 |
| api/mock-heavy sample | bunx + vitest | 1.35 |

## CI Stability Baseline (Latest 30 Completed Runs)

Failure rate excludes `cancelled` and `skipped` runs.

| Workflow | Success | Failure | Cancelled | Failure Rate |
| --- | ---: | ---: | ---: | ---: |
| `build.yml` | 16 | 0 | 12 | 0.0% |
| `electron-e2e.yml` | 30 | 0 | 0 | 0.0% |
| `android-maestro-release.yml` | 28 | 2 | 0 | 6.7% |
| `ios-maestro-release.yml` | 29 | 1 | 0 | 3.3% |

## Bun Test Compatibility Snapshot (2026-03-06 UTC)

Passes under `bun test` today:

- Full-package passes: `@tearleads/local-write-orchestrator`, `@tearleads/remote-read-orchestrator`, `@tearleads/msw`, `@tearleads/tee-api`, `@tearleads/vehicles`, `@tearleads/photos`
- Targeted-file passes:
  - `@tearleads/app-builder` (`src/generators/theme.test.ts`, `src/generators/utils.test.ts`)
  - `@tearleads/mls-core` (`src/mls.test.ts`)
  - `@tearleads/search` (`src/integration.documentFactories.test.ts`, `src/SearchStore.test.ts`)

Common blockers from sampled failing packages:

- Vitest-only mocks/APIs (`vi.hoisted`, `vi.importActual`, `vi.resetModules`) in packages like `search`, `compliance`, and `mls-core`
- DOM runtime assumptions without jsdom setup (`document` / `HTMLMediaElement` undefined) in packages like `ai` and `camera`
- Fetch/network behavior differences causing live network attempts in `tee-client`
- Vite-specific runtime features (`import.meta.glob`) used directly in tests/modules

## Migration SLOs / Go-No-Go Gates

1. Runtime pilot: Bun runtime (`bunx vitest`) must sustain at least `1.25x` median speedup across node/ui/api pilot suites.
2. CI stability: Required workflow failure rates must not regress by more than `+2.0` percentage points from this baseline during pilot rollout.
3. Platform guardrail: Electron, Android Maestro, and iOS Maestro pass rates must stay within the same `+2.0` point regression cap.
4. `bun test` promotion gate: A package can switch to `bun test` as primary only after a 2-week stability window with no runner-specific regressions and maintained coverage.

## Interpretation Notes

- Current measurements show Bun runtime gains for the selected pilot suites.
- `bun test` is very fast on the node-only sample, but this repository still has Vitest-specific patterns that require phased compatibility work before broad cutover.
- These numbers are directional and should be trended over time in CI before default-runtime changes.
