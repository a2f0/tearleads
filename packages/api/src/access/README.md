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

The `internal/` modules hold shared implementation details for the public
read/write APIs. New callers should import from `read/` or `write/`.

Shared public errors live under `errors/` when an error can be thrown by both
read and write APIs.
