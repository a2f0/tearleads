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

## Implementation Layout

The public API surface lives at `read/*.ts` and `write/*.ts`. New callers
should import from those modules, not from implementation directories.

Read-only implementation details live under `read/internal/`. Write-only
implementation details live under `write/internal/`.

Implementation that is still used by both public sides lives under
`shared/internal/`. In practice, the larger stores remain shared because their
read and write paths still share types, canonicalization helpers, and
transaction-scoped validation.

Allowed dependency direction:

- `read/internal/` may depend on `shared/internal/`
- `write/internal/` may depend on `read/internal/` and `shared/internal/`
- `shared/internal/` may depend on `read/internal/` for current-state
  validation, but not on `write/internal/`

Shared public errors live under `errors/` when an error can be thrown by both
read and write APIs.
