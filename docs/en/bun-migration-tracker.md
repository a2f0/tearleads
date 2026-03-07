# Bun Migration Tracker

Issue: [#2773](https://github.com/a2f0/tearleads/issues/2773)

## Current Phase Status

| Phase | Status | Notes |
| --- | --- | --- |
| Phase 0: Baseline and guardrails | Complete | Baseline and SLOs documented in [bun-migration-baseline.md](./bun-migration-baseline.md). |
| Phase 1: Bun runtime pilot (Vitest) | In progress | Pilot workflows are running; ongoing stability/perf tracking. |
| Phase 2: PM abstraction and script decoupling | In progress | `pm.sh` routing is now broad across hooks/workflows/scripts; remaining cleanup is mostly deprecation/removal work. |
| Phase 3: Node-only `bun test` migration | In progress | Node pilot packages now run Bun-first via `test`; Vitest fallback remains where needed. |
| Phase 4: Advanced compatibility remediation | Not started | Pending inventory/codemod of Vitest-specific APIs. |
| Phase 5: jsdom/UI-heavy strategy | Not started | Pending pilot package decisions. |
| Phase 6: CI default cutover and cleanup | Not started | Pending parity and release rehearsal gates. |

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
| [#2865](https://github.com/a2f0/tearleads/pull/2865) | `@tearleads/bob-and-alice` Bun-primary `test` script (stable Bun subset) |

## Node Pilot Package Status

| Package | Bun-primary script | Vitest fallback |
| --- | --- | --- |
| `@tearleads/app-builder` | `test` (`bun test ...`) | `test:vitest` |
| `@tearleads/bob-and-alice` | `test` (`bun test` stable subset) | `testVitest` |
| `@tearleads/local-write-orchestrator` | `test` (`bun test`) | n/a |
| `@tearleads/mls-core` | `test` (`bun test ...`) | `test:vitest` |
| `@tearleads/msw` | `test` (`bun test`) | n/a |
| `@tearleads/photos` | `test` (`bun test`) | n/a |
| `@tearleads/remote-read-orchestrator` | `test` (`bun test`) | n/a |
| `@tearleads/search` | `test` (`bun test ...`) | `test:vitest` |
| `@tearleads/tee-api` | `test` (`bun test`) | n/a |
| `@tearleads/vehicles` | `test` (`bun test`) | n/a |

## Next Milestones

1. Finish remaining pnpm-coupled cleanup and deprecate transitional-only paths once parity is proven.
2. Expand Bun-first package set where compatibility is already proven, then promote partial Bun suites (for example `bob-and-alice`) to full-suite Bun execution.
3. Start Phase 4 compatibility backlog inventory (`vi.hoisted`, `vi.importActual`, env/mocking gaps).
