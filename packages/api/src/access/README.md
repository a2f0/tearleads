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

Read and write APIs accept a `DatabaseExecutor` when they need database access.
Callers that compose multiple access-plane operations must pass the same
transaction executor through the whole workflow.

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

Shared public errors live under `errors/` when an error can be thrown by both
read and write APIs.

## Test Layout

Access tests live under `test/read/` and `test/write/` based on the public API
surface primarily under test. The tests may still use the opposite side for
setup or verification, so they stay under `test/` instead of the production
`read/` and `write/` directories.
