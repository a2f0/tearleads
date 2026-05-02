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
Write APIs expose database wrappers for standalone calls and `*InTransaction`
variants when a workflow already owns an open `DatabaseTransaction`.

Routes should generally call service/workflow functions, not compose these
modules directly. A workflow owns the atomic operation and decides which reads
and writes must commit or roll back together.

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
