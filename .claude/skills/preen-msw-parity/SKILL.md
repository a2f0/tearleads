---
name: preen-msw-parity
description: Audit MSW handlers against API routes and keep parity reporting current.
---


# Preen MSW Parity

Audit `@tearleads/msw` coverage against API routes, prioritize high-value gaps, and keep parity tooling up to date.

## When to Run

Run this skill when:

- API endpoints are added/changed in `packages/api/src/routes`
- MSW handlers are edited in `packages/msw/src/handlers.ts`
- You need a quick parity report before adding test coverage

## Discovery

Use the parity script first:

```bash
./scripts/preen/checkMswParity.ts
```

For machine-readable output:

```bash
./scripts/preen/checkMswParity.ts --json
```

To fail when parity has missing routes or low-confidence matcher coverage:

```bash
./scripts/preen/checkMswParity.ts --strict
```

## Prioritization

Work in this order:

1. Routes currently used by `packages/client/src/lib/api.ts`
2. Auth/session routes that affect app boot/login flows
3. Admin routes used by debug/admin UI
4. Remaining endpoints by prefix volume (e.g., `mls`, `vfs`, `ai`)

## Workflow

1. Run parity discovery and capture baseline counts.
2. Select one endpoint cluster and add/adjust handlers in `packages/msw/src/handlers.ts`.
3. Add/expand Vitest coverage that uses real fetch/MSW and asserts request metadata.
4. Re-run parity script and confirm missing/low-confidence counts are stable or decreased.
5. Run focused tests for touched suites.
6. Commit and open PR only when parity delta is positive.

## Test Wiring Guidance

- Prefer tests that call real API wrappers and assert:
  - response payload shape
  - request path/method via `getRecordedApiRequests` / `wasApiRequestMade`
- Keep request-state cleanup in shared setup (`resetMockApiServerState`).
- Avoid replacing all fetch mocks at once; migrate high-value suites incrementally.

## Guardrails

- Keep handlers aligned with shared response types in `@tearleads/shared`.
- Preserve optional `/v1` matching so tests work across base URL variants.
- Do not remove existing handler behavior without replacing equivalent coverage.
- Keep each PR scoped to one parity increment.

## Completion Gate

Before finishing a parity pass:

```bash
./scripts/preen/checkMswParity.ts --json
pnpm --filter @tearleads/msw test
pnpm --filter @tearleads/client exec vitest run src/test/msw/msw.test.ts src/lib/api.msw.test.ts
```

Then run:

- `/commit-and-push`
- `/enter-merge-queue`
