# Bun Compatibility Inventory

Generated: `2026-03-12T08:20:13.050Z` via `node --experimental-strip-types scripts/bun/generateCompatibilityInventory.ts`.

## Summary

- Packages with tests: 48
- Bun-primary test scripts: 43
- Transitional bun auto-fallback scripts: 0
- Vitest-primary test scripts: 4
- Packages with DOM/jsdom indicators: 31
- Packages using high-risk compatibility APIs/patterns (`vi.hoisted`, `vi.importActual`, `vi.mock(importOriginal)`, `vi.waitFor`, `import.meta.glob`, `vi.resetModules`): 2

## Top Blockers

| Package | Risk score | Blockers |
| --- | ---: | --- |
| `@tearleads/client` | 17 | vi.hoisted (40), vi.importActual (155), import.meta.glob (1), DOM setup (4 indicators; see Package Inventory), test script is vitest-primary |
| `@tearleads/api-client` | 5 | DOM setup (2 indicators; see Package Inventory), test script is vitest-primary |
| `@tearleads/app-compliance` | 5 | import.meta.glob (1), DOM setup (4 indicators; see Package Inventory) |
| `@tearleads/api` | 3 | test script is vitest-primary |
| `@tearleads/cli` | 3 | test script is vitest-primary |
| `@tearleads/app-admin` | 2 | DOM setup (4 indicators; see Package Inventory) |
| `@tearleads/app-ai` | 2 | DOM setup (4 indicators; see Package Inventory) |
| `@tearleads/app-analytics` | 2 | DOM setup (4 indicators; see Package Inventory) |
| `@tearleads/app-audio` | 2 | DOM setup (4 indicators; see Package Inventory) |
| `@tearleads/app-backups` | 2 | DOM setup (4 indicators; see Package Inventory) |
| `@tearleads/app-businesses` | 2 | DOM setup (4 indicators; see Package Inventory) |
| `@tearleads/app-calendar` | 2 | DOM setup (4 indicators; see Package Inventory) |
| `@tearleads/app-camera` | 2 | DOM setup (4 indicators; see Package Inventory) |
| `@tearleads/app-classic` | 2 | DOM setup (4 indicators; see Package Inventory) |
| `@tearleads/app-contacts` | 2 | DOM setup (4 indicators; see Package Inventory) |

## Package Inventory

| Package | Tests | Script mode | Vitest fallback script | Advanced APIs | DOM indicators | Readiness |
| --- | ---: | --- | --- | --- | --- | --- |
| `@tearleads/client` | 595 | `vitest-primary` | no | vi.hoisted:40, vi.importActual:155, import.meta.glob:1 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/api-client` | 56 | `vitest-primary` | no | none | DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/app-compliance` | 3 | `bun-primary` | yes | import.meta.glob:1 | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `high-remediation` |
| `@tearleads/api` | 156 | `vitest-primary` | no | none | none | `needs-remediation` |
| `@tearleads/cli` | 6 | `vitest-primary` | no | none | none | `needs-remediation` |
| `@tearleads/app-admin` | 59 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-ai` | 2 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-analytics` | 19 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-audio` | 27 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-backups` | 19 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-businesses` | 6 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-calendar` | 8 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-camera` | 2 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-classic` | 22 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-contacts` | 13 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-email` | 32 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-health` | 26 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-help` | 6 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-keychain` | 20 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-mls-chat` | 8 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-notes` | 10 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-notifications` | 7 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-settings` | 9 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-terminal` | 11 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/app-wallet` | 5 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/bun-dom-compat` | 1 | `none` | no | none | jsdom dependency | `needs-remediation` |
| `@tearleads/chrome-extension` | 8 | `bun-primary` | yes | none | jsdom dependency | `needs-remediation` |
| `@tearleads/db-test-utils` | 14 | `bun-primary` | yes | none | DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/ui` | 26 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/vfs-explorer` | 47 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/vfs-sync` | 82 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/website` | 11 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/window-manager` | 47 | `bun-primary` | yes | none | @testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency | `needs-remediation` |
| `@tearleads/api-test-utils` | 3 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/app-builder` | 2 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/app-photos` | 1 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/app-search` | 3 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/app-vehicles` | 3 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/bob-and-alice` | 37 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/db` | 30 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/local-write-orchestrator` | 1 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/mls-core` | 3 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/msw` | 2 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/remote-read-orchestrator` | 1 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/shared` | 18 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/smtp-listener` | 11 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/tee-api` | 5 | `bun-primary` | yes | none | none | `ready` |
| `@tearleads/tee-client` | 1 | `bun-primary` | yes | none | none | `ready` |

## Notes

- This inventory is heuristic and intended for Phase 4 planning, not as an absolute compatibility verdict.
- Prioritize high-risk packages first for shared adapter work and targeted codemods before promoting `bun test`.
