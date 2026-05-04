# Access APIs

This directory separates access-plane reads from access-plane writes.

## `read/`

Read APIs resolve current access state, KEK targets, stored key material, and
projection rows. They may validate that caller-supplied state is current, but
they should not persist new access-plane state.

## `write/`

Write APIs persist verified access-plane artifacts such as signed manifests,
KEK states, content-key bundles, attachment projections, and principal policy
state. They are low-level stores, not route-level business workflows.

## Transaction Boundary

Read APIs and lower-level helpers accept `DatabaseSession` when they need to run
SQL but do not own the transaction boundary. It exposes the statement methods
shared by the root database and active transactions, but not `.transaction()`.
Callers pass the root database or active transaction explicitly; these helpers
do not default to the singleton database. Write APIs expose database wrappers
for standalone calls and `*InTransaction` variants when a workflow already owns
an open `DatabaseTransaction`.

## Workflow Callers

Production callers should reach access modules through `workflows/`, with
route-facing `services/` acting as the stable API boundary:

```text
routes -> services -> workflows -> access/read + access/write
```

Workflows are the production layer allowed to compose `access/read` and
`access/write` calls directly. A workflow owns the atomic operation, opens the
transaction when one is required, and passes the same root database or active
transaction executor through every access read and write that must observe the
same state.

Services should keep request/session/runtime concerns at the edge and delegate
access-plane orchestration to workflow functions. Routes should call services,
not access modules directly. Tests may still import access APIs for setup and
verification.

Workflow conventions live in `../workflows/README.md`.

## Implementation Layout

The public API surface lives at `read/*.ts` and `write/*.ts`. New callers
should import from those modules, not from implementation directories.

Read-only implementation details may live under `read/internal/` when they are
not consumed by write paths. Write-only implementation details live under
`write/internal/`.

Implementation that is still used by both public sides lives under
`shared/internal/`. In practice, the larger stores remain shared because their
read and write paths still share types, canonicalization helpers, and
transaction-scoped validation. The KEK target resolvers also live there because
write paths use them to validate current targets before persisting content-key
state.

Allowed dependency direction:

- `read/internal/` may depend on `shared/internal/`
- `write/internal/` may depend on `read/internal/` and `shared/internal/`
- `shared/internal/` must not depend on `read/internal/` or `write/internal/`

The access dependency direction is enforced by `bun run lint:architecture`.

Implementation-specific errors live beside the implementation that throws them.
If callers need to handle one, re-export it from the relevant public
`read/*.ts` or `write/*.ts` module.

## Test Layout

Access tests live alongside the public API surface primarily under test:
`read/*.test.ts` for read APIs and `write/*.test.ts` for write APIs. The tests
may still use the opposite side for setup or verification.
