# Bun Compatibility Inventory

Generated: `2026-03-07T20:19:56.114Z` via `node --experimental-strip-types scripts/bun/generateCompatibilityInventory.ts`.

## Summary

- Packages with tests: 48
- Bun-primary test scripts: 12
- Transitional bun auto-fallback scripts: 3
- Vitest-primary test scripts: 33
- Packages with DOM/jsdom indicators: 33
- Packages using high-risk Vitest APIs (`vi.hoisted`, `vi.importActual`, `vi.resetModules`): 14

## Top Blockers

| Package | Risk score | Blockers |
| --- | ---: | --- |
| `@tearleads/api-client` | 20 | vi.hoisted (10), vi.importActual (11), vi.resetModules (28), vi.mocked (43), vi.stubEnv (30), DOM setup (DOM test environment in vitest config; jsdom dependency), test script is vitest-primary |
| `@tearleads/client` | 20 | vi.hoisted (68), vi.importActual (80), vi.resetModules (61), vi.mocked (438), vi.stubEnv (22), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), test script is vitest-primary |
| `@tearleads/keychain` | 19 | vi.hoisted (3), vi.importActual (1), vi.resetModules (2), vi.mocked (41), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), test script is vitest-primary |
| `@tearleads/api` | 18 | vi.hoisted (57), vi.importActual (19), vi.resetModules (9), vi.mocked (4), vi.stubEnv (41), test script is vitest-primary |
| `@tearleads/admin` | 15 | vi.importActual (7), vi.resetModules (4), vi.mocked (4), vi.stubEnv (4), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), test script is vitest-primary |
| `@tearleads/backups` | 12 | vi.hoisted (1), vi.mocked (8), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), test script is vitest-primary |
| `@tearleads/mls-chat` | 10 | vi.hoisted (1), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), test script is vitest-primary |
| `@tearleads/compliance` | 9 | vi.importActual (2), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), test script is vitest-primary |
| `@tearleads/console` | 9 | vi.importActual (1), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), test script is vitest-primary |
| `@tearleads/contacts` | 9 | vi.importActual (1), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), test script is vitest-primary |
| `@tearleads/help` | 9 | vi.importActual (1), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), test script is vitest-primary |
| `@tearleads/audio` | 8 | vi.resetModules (2), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), test script is vitest-primary |
| `@tearleads/chrome-extension` | 8 | vi.resetModules (7), DOM setup (jsdom dependency), test script is vitest-primary |
| `@tearleads/analytics` | 7 | vi.mocked (2), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), test script is vitest-primary |
| `@tearleads/email` | 7 | vi.mocked (2), DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency), test script is vitest-primary |

## Package Inventory

| Package | Tests | Script mode | Vitest fallback script | Advanced APIs | DOM indicators | Readiness |
| --- | ---: | --- | --- | --- | --- | --- |
| `@tearleads/api-client` | 52 | `vitest-primary` | no | vi.hoisted:10, vi.importActual:11, vi.resetModules:28, vi.mocked:43, vi.stubEnv:30 | DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/client` | 603 | `vitest-primary` | no | vi.hoisted:68, vi.importActual:80, vi.resetModules:61, vi.mocked:438, vi.stubEnv:22 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/keychain` | 20 | `vitest-primary` | no | vi.hoisted:3, vi.importActual:1, vi.resetModules:2, vi.mocked:41 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/api` | 152 | `vitest-primary` | no | vi.hoisted:57, vi.importActual:19, vi.resetModules:9, vi.mocked:4, vi.stubEnv:41 | none | `high-remediation` |
| `@tearleads/admin` | 58 | `vitest-primary` | no | vi.importActual:7, vi.resetModules:4, vi.mocked:4, vi.stubEnv:4 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/backups` | 18 | `vitest-primary` | no | vi.hoisted:1, vi.mocked:8 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/mls-chat` | 6 | `vitest-primary` | no | vi.hoisted:1 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/compliance` | 3 | `vitest-primary` | no | vi.importActual:2 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/console` | 5 | `vitest-primary` | no | vi.importActual:1 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/contacts` | 11 | `vitest-primary` | no | vi.importActual:1 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/help` | 6 | `vitest-primary` | no | vi.importActual:1 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/audio` | 21 | `vitest-primary` | no | vi.resetModules:2 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/chrome-extension` | 8 | `vitest-primary` | no | vi.resetModules:7 | jsdom dependency | `high-remediation` |
| `@tearleads/analytics` | 19 | `vitest-primary` | no | vi.mocked:2 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/email` | 27 | `vitest-primary` | no | vi.mocked:2 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/notes` | 7 | `vitest-primary` | no | vi.mocked:1 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/vfs-explorer` | 46 | `vitest-primary` | no | vi.mocked:36 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/shared` | 15 | `vitest-primary` | no | vi.resetModules:3 | none | `high-remediation` |
| `@tearleads/website` | 10 | `vitest-primary` | no | vi.stubEnv:1 | @testing-library/jest-dom dependency; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/ai` | 2 | `vitest-primary` | no | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/businesses` | 5 | `vitest-primary` | no | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/calendar` | 8 | `vitest-primary` | no | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/camera` | 2 | `vitest-primary` | no | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/classic` | 21 | `vitest-primary` | no | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/cli` | 6 | `vitest-primary` | no | vi.mocked:7 | none | `high-remediation` |
| `@tearleads/health` | 25 | `vitest-primary` | no | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/notifications` | 7 | `vitest-primary` | no | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/settings` | 7 | `vitest-primary` | no | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/terminal` | 11 | `vitest-primary` | no | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/ui` | 25 | `vitest-primary` | no | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/wallet` | 4 | `vitest-primary` | no | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/window-manager` | 43 | `vitest-primary` | no | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/db-test-utils` | 13 | `bun-auto-fallback` | yes | none | DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/mls-core` | 2 | `bun-auto-fallback` | yes | none | DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/tee-client` | 1 | `vitest-primary` | no | none | none | `needs-remediation` |
| `@tearleads/vfs-sync` | 82 | `bun-auto-fallback` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/photos` | 1 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/vehicles` | 2 | `bun-primary` | yes | vi.mocked:1 | none | `needs-remediation` |
| `@tearleads/bob-and-alice` | 29 | `bun-primary` | yes | vi.stubEnv:1 | none | `ready` |
| `@tearleads/api-test-utils` | 3 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/app-builder` | 2 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/db` | 30 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/local-write-orchestrator` | 1 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/msw` | 2 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/remote-read-orchestrator` | 1 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/search` | 3 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/smtp-listener` | 11 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/tee-api` | 5 | `bun-primary` | yes | none | none | `ready` |

## Notes

- This inventory is heuristic and intended for Phase 4 planning, not as an absolute compatibility verdict.
- Prioritize high-risk packages first for shared adapter work and targeted codemods before promoting `bun test`.
