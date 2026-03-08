# Bun Compatibility Inventory

Generated: `2026-03-08T21:56:24.761Z` via `node --experimental-strip-types scripts/bun/generateCompatibilityInventory.ts`.

## Summary

- Packages with tests: 48
- Bun-primary test scripts: 28
- Transitional bun auto-fallback scripts: 12
- Vitest-primary test scripts: 8
- Packages with DOM/jsdom indicators: 31
- Packages using high-risk Vitest APIs (`vi.hoisted`, `vi.importActual`, `vi.mock(importOriginal)`, `vi.resetModules`): 15

## Top Blockers

| Package | Risk score | Blockers |
| --- | ---: | --- |
| `@tearleads/client` | 24 | vi.hoisted (70), vi.importActual (80), vi.mock(importOriginal) (86), vi.resetModules (44), vi.mocked (442), vi.stubEnv (22), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), test script is vitest-primary |
| `@tearleads/keychain` | 23 | vi.hoisted (3), vi.importActual (1), vi.mock(importOriginal) (6), vi.resetModules (2), vi.mocked (50), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), test script is vitest-primary |
| `@tearleads/api` | 22 | vi.hoisted (57), vi.importActual (19), vi.mock(importOriginal) (1), vi.resetModules (9), vi.mocked (4), vi.stubEnv (41), test script is vitest-primary |
| `@tearleads/api-client` | 20 | vi.hoisted (10), vi.importActual (11), vi.resetModules (28), vi.mocked (43), vi.stubEnv (30), DOM setup (DOM test environment in vitest config; jsdom dependency), test script is vitest-primary |
| `@tearleads/admin` | 19 | vi.importActual (7), vi.mock(importOriginal) (9), vi.resetModules (4), vi.mocked (4), vi.stubEnv (4), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), test script is vitest-primary |
| `@tearleads/backups` | 12 | vi.hoisted (1), vi.mocked (8), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), test script is vitest-primary |
| `@tearleads/console` | 11 | vi.importActual (1), vi.mock(importOriginal) (2), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), transitional test script uses bun auto-fallback |
| `@tearleads/help` | 11 | vi.importActual (1), vi.mock(importOriginal) (2), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), transitional test script uses bun auto-fallback |
| `@tearleads/analytics` | 9 | vi.mock(importOriginal) (11), vi.mocked (2), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), transitional test script uses bun auto-fallback |
| `@tearleads/audio` | 8 | vi.resetModules (2), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), test script is vitest-primary |
| `@tearleads/compliance` | 7 | vi.importActual (2), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), transitional test script uses bun auto-fallback |
| `@tearleads/contacts` | 7 | vi.importActual (1), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), transitional test script uses bun auto-fallback |
| `@tearleads/mls-chat` | 7 | vi.hoisted (1), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency) |
| `@tearleads/notifications` | 7 | vi.mock(importOriginal) (2), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), transitional test script uses bun auto-fallback |
| `@tearleads/chrome-extension` | 6 | vi.resetModules (7), DOM setup (jsdom dependency), transitional test script uses bun auto-fallback |

## Package Inventory

| Package | Tests | Script mode | Vitest fallback script | Advanced APIs | DOM indicators | Readiness |
| --- | ---: | --- | --- | --- | --- | --- |
| `@tearleads/client` | 599 | `vitest-primary` | no | vi.hoisted:70, vi.importActual:80, vi.mock(importOriginal):86, vi.resetModules:44, vi.mocked:442, vi.stubEnv:22 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/keychain` | 20 | `vitest-primary` | no | vi.hoisted:3, vi.importActual:1, vi.mock(importOriginal):6, vi.resetModules:2, vi.mocked:50 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/api` | 152 | `vitest-primary` | no | vi.hoisted:57, vi.importActual:19, vi.mock(importOriginal):1, vi.resetModules:9, vi.mocked:4, vi.stubEnv:41 | none | `high-remediation` |
| `@tearleads/api-client` | 52 | `vitest-primary` | no | vi.hoisted:10, vi.importActual:11, vi.resetModules:28, vi.mocked:43, vi.stubEnv:30 | DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/admin` | 58 | `vitest-primary` | no | vi.importActual:7, vi.mock(importOriginal):9, vi.resetModules:4, vi.mocked:4, vi.stubEnv:4 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/backups` | 19 | `vitest-primary` | no | vi.hoisted:1, vi.mocked:8 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/console` | 5 | `bun-auto-fallback` | yes | vi.importActual:1, vi.mock(importOriginal):2 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/help` | 6 | `bun-auto-fallback` | yes | vi.importActual:1, vi.mock(importOriginal):2 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/analytics` | 19 | `bun-auto-fallback` | yes | vi.mock(importOriginal):11, vi.mocked:2 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/audio` | 22 | `vitest-primary` | no | vi.resetModules:2 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/compliance` | 3 | `bun-auto-fallback` | yes | vi.importActual:2 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/contacts` | 11 | `bun-auto-fallback` | yes | vi.importActual:1 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/mls-chat` | 8 | `bun-primary` | yes | vi.hoisted:1 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/notifications` | 7 | `bun-auto-fallback` | yes | vi.mock(importOriginal):2 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/chrome-extension` | 8 | `bun-auto-fallback` | yes | vi.resetModules:7 | jsdom dependency | `high-remediation` |
| `@tearleads/cli` | 6 | `vitest-primary` | no | vi.mocked:7 | none | `high-remediation` |
| `@tearleads/email` | 28 | `bun-auto-fallback` | yes | vi.mocked:2 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/vfs-explorer` | 47 | `bun-auto-fallback` | yes | vi.mocked:36 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/notes` | 8 | `bun-primary` | yes | vi.mocked:1 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/classic` | 21 | `bun-auto-fallback` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/ui` | 25 | `bun-auto-fallback` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/window-manager` | 43 | `bun-auto-fallback` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/ai` | 2 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/businesses` | 5 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/calendar` | 8 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/camera` | 2 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/db-test-utils` | 14 | `bun-primary` | yes | none | DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/health` | 25 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/settings` | 7 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/terminal` | 11 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/vfs-sync` | 82 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/wallet` | 4 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/website` | 11 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/bob-and-alice` | 31 | `bun-primary` | yes | vi.stubEnv:1 | none | `ready` |
| `@tearleads/api-test-utils` | 3 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/app-builder` | 2 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/db` | 30 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/local-write-orchestrator` | 1 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/mls-core` | 2 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/msw` | 2 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/photos` | 1 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/remote-read-orchestrator` | 1 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/search` | 3 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/shared` | 16 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/smtp-listener` | 11 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/tee-api` | 5 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/tee-client` | 1 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/vehicles` | 2 | `bun-primary` | yes | none | none | `ready` |

## Notes

- This inventory is heuristic and intended for Phase 4 planning, not as an absolute compatibility verdict.
- Prioritize high-risk packages first for shared adapter work and targeted codemods before promoting `bun test`.
