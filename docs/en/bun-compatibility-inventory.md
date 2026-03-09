# Bun Compatibility Inventory

Generated: `2026-03-09T18:07:11.765Z` via `node --experimental-strip-types scripts/bun/generateCompatibilityInventory.ts`.

## Summary

- Packages with tests: 48
- Bun-primary test scripts: 39
- Transitional bun auto-fallback scripts: 0
- Vitest-primary test scripts: 8
- Packages with DOM/jsdom indicators: 31
- Packages using high-risk compatibility APIs/patterns (`vi.hoisted`, `vi.importActual`, `vi.mock(importOriginal)`, `vi.waitFor`, `import.meta.glob`, `vi.resetModules`): 12

## Top Blockers

| Package | Risk score | Blockers |
| --- | ---: | --- |
| `@tearleads/client` | 30 | vi.hoisted (71), vi.importActual (82), vi.mock(importOriginal) (100), vi.waitFor (8), import.meta.glob (1), vi.resetModules (46), vi.mocked (444), vi.stubEnv (22), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), test script is vitest-primary |
| `@tearleads/api` | 25 | vi.hoisted (60), vi.importActual (19), vi.mock(importOriginal) (1), vi.waitFor (3), vi.resetModules (9), vi.mocked (4), vi.stubEnv (41), test script is vitest-primary |
| `@tearleads/app-keychain` | 23 | vi.hoisted (3), vi.importActual (1), vi.mock(importOriginal) (6), vi.resetModules (2), vi.mocked (50), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), test script is vitest-primary |
| `@tearleads/api-client` | 20 | vi.hoisted (10), vi.importActual (11), vi.resetModules (28), vi.mocked (43), vi.stubEnv (30), DOM setup (DOM test environment in vitest config; jsdom dependency), test script is vitest-primary |
| `@tearleads/app-admin` | 19 | vi.importActual (7), vi.mock(importOriginal) (9), vi.resetModules (4), vi.mocked (4), vi.stubEnv (4), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), test script is vitest-primary |
| `@tearleads/app-backups` | 12 | vi.hoisted (1), vi.mocked (8), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), test script is vitest-primary |
| `@tearleads/app-analytics` | 8 | vi.mock(importOriginal) (11), vi.mocked (2), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency) |
| `@tearleads/app-audio` | 8 | vi.resetModules (2), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), test script is vitest-primary |
| `@tearleads/app-mls-chat` | 7 | vi.hoisted (1), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency) |
| `@tearleads/app-notifications` | 6 | vi.mock(importOriginal) (1), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency) |
| `@tearleads/app-classic` | 5 | vi.waitFor (5), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency) |
| `@tearleads/app-compliance` | 5 | import.meta.glob (1), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency) |
| `@tearleads/cli` | 5 | vi.mocked (7), test script is vitest-primary |
| `@tearleads/app-email` | 4 | vi.mocked (2), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency) |
| `@tearleads/app-notes` | 4 | vi.mocked (1), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency) |

## Package Inventory

| Package | Tests | Script mode | Vitest fallback script | Advanced APIs | DOM indicators | Readiness |
| --- | ---: | --- | --- | --- | --- | --- |
| `@tearleads/client` | 602 | `vitest-primary` | no | vi.hoisted:71, vi.importActual:82, vi.mock(importOriginal):100, vi.waitFor:8, import.meta.glob:1, vi.resetModules:46, vi.mocked:444, vi.stubEnv:22 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/api` | 155 | `vitest-primary` | no | vi.hoisted:60, vi.importActual:19, vi.mock(importOriginal):1, vi.waitFor:3, vi.resetModules:9, vi.mocked:4, vi.stubEnv:41 | none | `high-remediation` |
| `@tearleads/app-keychain` | 20 | `vitest-primary` | no | vi.hoisted:3, vi.importActual:1, vi.mock(importOriginal):6, vi.resetModules:2, vi.mocked:50 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/api-client` | 52 | `vitest-primary` | no | vi.hoisted:10, vi.importActual:11, vi.resetModules:28, vi.mocked:43, vi.stubEnv:30 | DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/app-admin` | 57 | `vitest-primary` | no | vi.importActual:7, vi.mock(importOriginal):9, vi.resetModules:4, vi.mocked:4, vi.stubEnv:4 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/app-backups` | 19 | `vitest-primary` | no | vi.hoisted:1, vi.mocked:8 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/app-analytics` | 19 | `bun-primary` | yes | vi.mock(importOriginal):11, vi.mocked:2 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/app-audio` | 27 | `vitest-primary` | no | vi.resetModules:2 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/app-mls-chat` | 8 | `bun-primary` | yes | vi.hoisted:1 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/app-notifications` | 7 | `bun-primary` | yes | vi.mock(importOriginal):1 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/app-classic` | 21 | `bun-primary` | yes | vi.waitFor:5 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/app-compliance` | 3 | `bun-primary` | yes | import.meta.glob:1 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/cli` | 6 | `vitest-primary` | no | vi.mocked:7 | none | `high-remediation` |
| `@tearleads/app-email` | 30 | `bun-primary` | yes | vi.mocked:2 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-notes` | 10 | `bun-primary` | yes | vi.mocked:1 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/vfs-explorer` | 47 | `bun-primary` | yes | vi.mocked:36 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-ai` | 2 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-businesses` | 6 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-calendar` | 8 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-camera` | 2 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-contacts` | 13 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-health` | 26 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-help` | 6 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-settings` | 9 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-terminal` | 11 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-wallet` | 5 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/bun-dom-compat` | 1 | `none` | no | none | jsdom dependency | `needs-remediation` |
| `@tearleads/chrome-extension` | 8 | `bun-primary` | yes | none | jsdom dependency | `needs-remediation` |
| `@tearleads/db-test-utils` | 14 | `bun-primary` | yes | none | DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/ui` | 25 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/vfs-sync` | 82 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/website` | 11 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/window-manager` | 43 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/bob-and-alice` | 37 | `bun-primary` | yes | vi.stubEnv:1 | none | `ready` |
| `@tearleads/api-test-utils` | 3 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/app-builder` | 2 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/app-photos` | 1 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/app-search` | 3 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/app-vehicles` | 3 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/db` | 30 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/local-write-orchestrator` | 1 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/mls-core` | 2 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/msw` | 2 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/remote-read-orchestrator` | 1 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/shared` | 16 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/smtp-listener` | 11 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/tee-api` | 5 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/tee-client` | 1 | `bun-primary` | yes | none | none | `ready` |

## Notes

- This inventory is heuristic and intended for Phase 4 planning, not as an absolute compatibility verdict.
- Prioritize high-risk packages first for shared adapter work and targeted codemods before promoting `bun test`.
