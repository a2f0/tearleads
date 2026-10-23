# Access APIs

This directory separates access-plane reads from access-plane writes.

## `read/`

Read APIs resolve current access state, KEK targets, stored key material, and
projection rows. They may validate that caller-supplied state is current, but
they do not persist new access-plane state.

## `write/`

Write APIs persist verified access-plane artifacts such as signed manifests,
KEK states, content-key bundles, attachment bindings, and principal state. They
are low-level stores, not route-level business workflows.

## Transaction Boundary

Read APIs and lower-level helpers that run SQL without owning the transaction
boundary accept a `DatabaseSession`: the statement methods shared by the root
database and an active transaction, without `.transaction()`. Callers pass the
root database or the active transaction explicitly; these helpers never default
to a singleton database. Write APIs offer `*InTransaction` variants that run
inside a workflow's open `DatabaseTransaction`, plus standalone wrappers where
a caller needs one.

## Workflow Callers

Production callers reach access modules through `workflows/`, with
route-facing `services/` as the stable API boundary:

```text
routes -> services -> workflows -> access/read + access/write
```

Workflows are the only production layer that composes `access/read` and
`access/write` calls. A workflow owns the atomic operation, opens the
transaction when one is required, and passes the same root database or active
transaction through every access read and write that must observe the same
state.

Services keep request, session, and runtime concerns at the edge and delegate
access-plane orchestration to workflows. Routes call services, never access
modules or workflows; services never import routes. Tests may import access
APIs for setup and verification.

Production code outside `workflows/` does not import access APIs, even the
public `read/` and `write/` modules. Support code that needs access state moves
the orchestration into a workflow or takes already-loaded domain data.

Workflow conventions live in `../workflows/README.md`.

## Implementation Layout

The public API surface is `read/*.ts` and `write/*.ts`; code outside
`access/` imports only those modules. These thin files are deliberate
read/write boundary facades, not convenience barrels, so do not add
`index.ts`, `types.ts`, or one-line re-export shims that define no layer
boundary.

Read-only implementation details live under `read/internal/`, and write-only
details belong under `write/internal/`. Implementation used by both sides lives
under `shared/internal/`: the larger stores, whose read and write paths share
types, canonicalization helpers, and transaction-scoped validation, and the KEK
target resolvers, which write paths use to validate current targets before
persisting content-key state.

Allowed dependency direction:

- `read/` (including `read/internal/`) may depend on `shared/internal/`, never
  on `write/`.
- `write/` may depend on `read/` and `shared/internal/`.
- `shared/internal/` must not depend on `read/` or `write/`.
- Nothing in `access/` depends on routes, services, or workflows.

`bun run lint:architecture` enforces these directions.

Implementation-specific errors live beside the implementation that throws them.
If callers need to handle one, re-export it from the relevant public
`read/*.ts` or `write/*.ts` module.

## Test Layout

Access tests sit beside the public modules: `read/*.test.ts` for read APIs and
`write/*.test.ts` for write APIs. A test may use the opposite side for setup or
verification.
