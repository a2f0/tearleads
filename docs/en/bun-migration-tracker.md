# Bun Migration Tracker

Issue: [#2773](https://github.com/a2f0/tearleads/issues/2773)

## Current Phase Status

| Phase | Status | Notes |
| --- | --- | --- |
| Phase 0: Baseline and guardrails | Complete | Baseline and SLOs documented in [bun-migration-baseline.md](./bun-migration-baseline.md). |
| Phase 1: Bun runtime pilot (Vitest) | In progress | Pilot workflows are running; ongoing stability/perf tracking. |
| Phase 2: PM abstraction and script decoupling | In progress | `pm.sh` routing is now broad across hooks/workflows/scripts; remaining cleanup is mostly deprecation/removal work. |
| Phase 3: Node-only `bun test` migration | In progress | Node pilot packages now run Bun-first via `test`; Vitest fallback remains where needed. |
| Phase 4: Advanced compatibility remediation | In progress | Compatibility inventory is tracked in [bun-compatibility-inventory.md](./bun-compatibility-inventory.md); fallback classification is now accurate and Bun DOM setup shims are centralized. |
| Phase 5: jsdom/UI-heavy strategy | Not started | Pending pilot package decisions. |
| Phase 6: CI default cutover and cleanup | Not started | Pending parity and release rehearsal gates. |

## Compatibility Snapshot (2026-03-09)

- Packages with tests: 49
- Bun-primary `test` scripts: 33
- Transitional bun auto-fallback scripts: 7
- Vitest-primary `test` scripts: 8
- High-risk compatibility API/pattern packages (`vi.hoisted`, `vi.importActual`, `vi.mock(importOriginal)`, `vi.waitFor`, `import.meta.glob`, `vi.resetModules`): 14

## Merged Slices

| PR | Slice |
| --- | --- |
| [#2778](https://github.com/a2f0/tearleads/pull/2778) | pm wrapper and runner abstraction |
| [#2782](https://github.com/a2f0/tearleads/pull/2782) | Bun runtime + Vitest CI pilot |
| [#2785](https://github.com/a2f0/tearleads/pull/2785) | ciImpact Bun transition hardening |
| [#2786](https://github.com/a2f0/tearleads/pull/2786) | Baseline report + migration SLOs |
| [#2790](https://github.com/a2f0/tearleads/pull/2790) | Node-only `bun test` pilot bootstrap |
| [#2793](https://github.com/a2f0/tearleads/pull/2793) | Expanded Bun node pilot matrix |
| [#2796](https://github.com/a2f0/tearleads/pull/2796) | UI-light Bun pilot (`photos`) |
| [#2798](https://github.com/a2f0/tearleads/pull/2798) | Expanded partial Bun pilot coverage |
| [#2805](https://github.com/a2f0/tearleads/pull/2805) | High-traffic scripts to `pm.sh` |
| [#2808](https://github.com/a2f0/tearleads/pull/2808) | Platform workflow `pm.sh` routing |
| [#2810](https://github.com/a2f0/tearleads/pull/2810) | Deploy workflow `pm.sh` routing |
| [#2811](https://github.com/a2f0/tearleads/pull/2811) | Build workflow `pm.sh` routing |
| [#2812](https://github.com/a2f0/tearleads/pull/2812) | Web workflow `pm.sh` routing |
| [#2818](https://github.com/a2f0/tearleads/pull/2818) | Desktop deploy workflow `pm.sh` routing |
| [#2819](https://github.com/a2f0/tearleads/pull/2819) | ciImpact strip-types + CI gate decouple |
| [#2822](https://github.com/a2f0/tearleads/pull/2822) | Bun pilot workflow `pm.sh` routing |
| [#2824](https://github.com/a2f0/tearleads/pull/2824) | Bob-and-Alice Bun pilot expansion |
| [#2825](https://github.com/a2f0/tearleads/pull/2825) | Impacted quality via `pm.sh` |
| [#2827](https://github.com/a2f0/tearleads/pull/2827) | ciImpact script fallback via `pm.sh` |
| [#2828](https://github.com/a2f0/tearleads/pull/2828) | Bun-primary node pilot scripts |
| [#2832](https://github.com/a2f0/tearleads/pull/2832) | `scripts/users` runtime-agnostic entrypoints |
| [#2834](https://github.com/a2f0/tearleads/pull/2834) | Agent/tooling shebang decoupling |
| [#2836](https://github.com/a2f0/tearleads/pull/2836) | Bun migration tracker dashboard doc |
| [#2837](https://github.com/a2f0/tearleads/pull/2837) | pre-push `pm.sh` + strip-types runtime decoupling |
| [#2840](https://github.com/a2f0/tearleads/pull/2840) | Safe utility shebang runtime decoupling |
| [#2841](https://github.com/a2f0/tearleads/pull/2841) | API CLI shebang runtime decoupling |
| [#2842](https://github.com/a2f0/tearleads/pull/2842) | Check scripts shebang runtime decoupling |
| [#2844](https://github.com/a2f0/tearleads/pull/2844) | Utility script shebang runtime decoupling |
| [#2848](https://github.com/a2f0/tearleads/pull/2848) | Safe script shebang runtime decoupling |
| [#2849](https://github.com/a2f0/tearleads/pull/2849) | Deploy key script help + shebang runtime decoupling |
| [#2850](https://github.com/a2f0/tearleads/pull/2850) | Compat shim checker self-exclusion |
| [#2851](https://github.com/a2f0/tearleads/pull/2851) | Final check-script shebang migration |
| [#2855](https://github.com/a2f0/tearleads/pull/2855) | `@tearleads/app-builder` Bun-primary test |
| [#2857](https://github.com/a2f0/tearleads/pull/2857) | `@tearleads/mls-core` Bun-primary test + mock compatibility |
| [#2861](https://github.com/a2f0/tearleads/pull/2861) | `@tearleads/search` Bun-primary test + mock compatibility |
| [#2865](https://github.com/a2f0/tearleads/pull/2865) | `@tearleads/bob-and-alice` Bun-primary `test` script bootstrap |
| [#2868](https://github.com/a2f0/tearleads/pull/2868) | Tracker dashboard refresh for Bun migration state |
| [#2869](https://github.com/a2f0/tearleads/pull/2869) | Bun node-pilot fallback script naming (`testVitest`) |
| [#2875](https://github.com/a2f0/tearleads/pull/2875) | `@tearleads/bob-and-alice` full-suite Bun primary path |
| [#2877](https://github.com/a2f0/tearleads/pull/2877) | Bob-and-Alice clean-checkout runtime loaders (API/DB deps) |
| [#2878](https://github.com/a2f0/tearleads/pull/2878) | Bob-and-Alice loader hardening (`db-test-utils`, local-write orchestrator, no-assertion cleanup) |
| [#2880](https://github.com/a2f0/tearleads/pull/2880) | Tracker dashboard refresh for Bun migration state |
| [#2882](https://github.com/a2f0/tearleads/pull/2882) | `@tearleads/api-test-utils` Bun-primary compatibility remediation |
| [#2888](https://github.com/a2f0/tearleads/pull/2888) | `@tearleads/smtp-listener` Bun-primary compatibility remediation |
| [#2891](https://github.com/a2f0/tearleads/pull/2891) | `@tearleads/db` Bun-primary test |
| [#2894](https://github.com/a2f0/tearleads/pull/2894) | `@tearleads/db-test-utils` Bun-primary test |
| [#2895](https://github.com/a2f0/tearleads/pull/2895) | `@tearleads/vfs-sync` Bun-primary compatibility remediation |
| [#2898](https://github.com/a2f0/tearleads/pull/2898) | `@tearleads/remote-read-orchestrator` Bun-primary coverage |
| [#2900](https://github.com/a2f0/tearleads/pull/2900) | `@tearleads/tee-api` Bun-primary coverage |
| [#2901](https://github.com/a2f0/tearleads/pull/2901) | `@tearleads/db-test-utils` Bun-primary coverage |
| [#2903](https://github.com/a2f0/tearleads/pull/2903) | `@tearleads/db` Bun-primary coverage |
| [#2908](https://github.com/a2f0/tearleads/pull/2908) | `@tearleads/smtp-listener` Bun-primary coverage |
| [#2910](https://github.com/a2f0/tearleads/pull/2910) | `@tearleads/api-test-utils` Bun-primary coverage |
| [#2913](https://github.com/a2f0/tearleads/pull/2913) | `@tearleads/mls-core` Bun-primary coverage |
| [#2914](https://github.com/a2f0/tearleads/pull/2914) | `@tearleads/msw` Bun-primary coverage |
| [#2918](https://github.com/a2f0/tearleads/pull/2918) | Node pilot package batch coverage promotion |
| [#2921](https://github.com/a2f0/tearleads/pull/2921) | Coverage worker flag normalization (`bun`/`vitest`) |
| [#2923](https://github.com/a2f0/tearleads/pull/2923) | Shared coverage runner consolidation |
| [#2930](https://github.com/a2f0/tearleads/pull/2930) | Bun compatibility hardening for Bob-and-Alice email detail parsing |
| [#2939](https://github.com/a2f0/tearleads/pull/2939) | Bun-primary coverage runner alignment |
| [#2964](https://github.com/a2f0/tearleads/pull/2964) | `@tearleads/notes` Bun-primary migration |
| [#2971](https://github.com/a2f0/tearleads/pull/2971) | Bun-primary migration for classic/email/notifications/mls-chat |
| [#2994](https://github.com/a2f0/tearleads/pull/2994) | Compatibility inventory fallback-classification correction |
| [#2996](https://github.com/a2f0/tearleads/pull/2996) | Tracker dashboard refresh for Bun migration state |
| [#2998](https://github.com/a2f0/tearleads/pull/2998) | Bun compatibility remediation for `vi.hoisted` polyfill and shared setup |
| [#3000](https://github.com/a2f0/tearleads/pull/3000) | `@tearleads/mls-chat` Bun-primary `test` script |
| [#3002](https://github.com/a2f0/tearleads/pull/3002) | Compatibility inventory `vi.mock(importOriginal)` blocker detection |
| [#3007](https://github.com/a2f0/tearleads/pull/3007) | Compatibility inventory `vi.waitFor` blocker detection |
| [#3031](https://github.com/a2f0/tearleads/pull/3031) | Promote analytics/compliance/ui to Bun-primary `test` scripts |
| [#3037](https://github.com/a2f0/tearleads/pull/3037) | Refresh Bun migration tracker snapshot + merged slices ledger |

## Node Pilot Package Status

| Package | Bun-primary script | Vitest fallback | Notes |
| --- | --- | --- | --- |
| `@tearleads/app-builder` | `test` (`bun test ...`) | `testVitest` | Bun-primary full package suite |
| `@tearleads/bob-and-alice` | `test` (`bun test src/**/*.test.ts`) | `testVitest` | Bun-primary full package suite with clean-checkout runtime loaders for dist-only dependencies |
| `@tearleads/local-write-orchestrator` | `test` (`bun test`) | n/a | Bun-primary full package suite |
| `@tearleads/mls-core` | `test` (`bun test ...`) | `testVitest` | Bun-primary full package suite |
| `@tearleads/msw` | `test` (`bun test`) | n/a | Bun-primary full package suite |
| `@tearleads/photos` | `test` (`bun test`) | n/a | Bun-primary full package suite |
| `@tearleads/remote-read-orchestrator` | `test` (`bun test`) | n/a | Bun-primary full package suite |
| `@tearleads/search` | `test` (`bun test ...`) | `testVitest` | Bun-primary full package suite |
| `@tearleads/tee-api` | `test` (`bun test`) | n/a | Bun-primary full package suite |
| `@tearleads/vehicles` | `test` (`bun test`) | n/a | Bun-primary full package suite |

## Next Milestones

1. Finish remaining pnpm-coupled cleanup and deprecate transitional-only paths once parity is proven.
2. Use [bun-compatibility-inventory.md](./bun-compatibility-inventory.md) to drive shared adapters and codemods for top blockers (`vi.hoisted`, `vi.importActual`, `vi.mock(importOriginal)`, `vi.waitFor`, `import.meta.glob`, `vi.resetModules`, `vi.mocked`).
3. Burn down the 7 packages still using `bun-auto-fallback` in `test` scripts by converting only validated packages to explicit Bun-primary + `testVitest` fallback.
