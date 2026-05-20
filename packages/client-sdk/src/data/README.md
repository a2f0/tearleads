# Client SDK Data Architecture

The client SDK keeps SQLite execution explicit. `ExecSql` carries the active
database connection, serialized mutation queue, and nested transaction
behavior, so it should not be replaced with a global database handle.

The intended dependency direction is:

```text
host adapters -> SDK stores -> SDK workflows -> data/persistence + data/sqlite + data/blobs + data/contacts + shared helpers
```

## Layers

- Host application UI, document-type components, and product hooks live outside
  the SDK and call into SDK stores or workflow facades.
- Store modules under `../stores/` own subscriptions, sync scheduling, state
  machines, and event fanout without importing React.
- Workflows under `../workflows/` own multi-step client operations that compose
  API calls, local persistence, key/projection verification, and transaction
  boundaries.
- Persistence modules under `persistence/` are domain-specific SQLite stores.
  They keep taking explicit `ExecSql` values and should not import React,
  providers, UI, hooks, or workflows.
- SQLite internals under `sqlite/` own the executor adapter, Drizzle schema
  definitions, transaction serialization, and shared table helpers.
- Blob storage internals under `blobs/` own the OPFS/memory byte stores.
  Host adapters and stores should consume the blob workflow facade instead of
  importing these stores directly.
- Blob byte/store contracts live in `blobContracts.ts` so presentation and
  workflows can share typed attachment payloads without importing workflow
  barrels or storage internals.
- Sync coordination helpers under `sync/` own shared lane scheduling and
  prerequisite checks. Workflows compose them; presentation should stay behind
  stores/providers. Runtime-idle helpers that need to observe sync activity
  should use the sync workflow facade instead of importing these internals.
- Document summary contracts live in `documentSummary.ts` so presentation,
  stores, workflows, and persistence can share document read-model shapes
  without importing document shared-helper internals.
- Contact data internals under `contacts/` own low-level address-book record
  contracts and document serialization helpers. Host adapters should consume
  the contacts workflow facade for contact read-model types.
- Shared helpers and domain read-model contracts hold pure or mostly pure
  projection, crypto, event, request, response validation, and view-facing data
  shapes that workflows and stores can reuse without importing provider or UI
  layers.

## Import Surface

`data/` is an internal SDK layer, not an application integration API. The SDK
root is reserved for neutral contracts and pure document helpers. Host
application code should import operations from store or workflow facades.
Cross-package callers should not import `@tearleads/client-sdk/data/*`
subpaths; promote the needed contract through the root or an explicit workflow
facade instead.

Package subpath exports are explicit and should stop at the facade boundary.
Adding a new cross-package import from `stores/` or `workflows/` should usually
mean adding or widening a domain facade export, such as
`@tearleads/client-sdk/workflows/documents`, rather than exporting a nested
implementation file. Low-level `data/` modules should stay package-internal
unless there is a deliberate decision to promote a new public SDK contract.

Use facade subpaths directly, such as `@tearleads/client-sdk/workflows/documents`
and `@tearleads/client-sdk/stores/documents`, instead of importing their
implementation `index` modules or nested workflow/store implementation files.
Shared sync coordination helpers that cross host test/runtime boundaries belong
behind `@tearleads/client-sdk/workflows/sync`.

Do not re-export store or workflow facades from the SDK root. Keeping the root
neutral makes the default import surface small while preserving explicit domain
entry points for operational APIs.

Avoid `index.ts`, `types.ts`, and other one-line re-export shims inside data
domains when they only shorten import paths. Keep a facade only when it marks a
real layer boundary, such as a workflow, store, provider, or explicit neutral
contract module shared by multiple layers.

## Executor Boundary

Host adapters may create or receive the root SDK runtime and pass a workflow
context into workflow entry points. Inside persistence stores and
transaction-scoped workflow code, pass the active executor explicitly so all
reads and writes share the same SQLite connection and serialization boundary.

Adapter/store code should not thread raw `ExecSql` through every intermediate
helper when a workflow context would express the operation more clearly. That
cleanup should be incremental and behavior-preserving.

## Rules

- Production `data/` modules must not import UI, providers, hooks, or
  workflows, including for type-only contracts. Test-only fixture builders that
  need workflow types belong under `packages/client-sdk/test/helpers/`.
- Production callers should import data-domain implementations and contracts
  from concrete modules, not convenience barrels or pass-through shims.
- `workflows/` modules must not import UI, hooks, or providers, including for
  type-only contracts.
- Production SDK `data/`, `stores/`, and `workflows/` files must not import
  React; React hooks and runtime adapters belong outside the core SDK.
- Shared helper modules under document and container data domains must stay
  layer-neutral, including for type-only contracts.
- Production host UI and product hooks should go through stores or providers
  rather than importing persistence stores or `data/sqlite/` directly,
  including for type-only contracts. Runtime workflow calls and workflow-owned
  contracts should also stay behind stores or providers. Presentation should
  use neutral data contracts instead of importing document/container
  shared-helper internals directly.
- Production host stores, providers, and identity runtime should consume domain
  workflow facades rather than importing `data/persistence/`, `data/sqlite/`,
  `data/blobs/`, or `data/contacts/` directly. The host application's data
  provider is the executor construction boundary. Tests may still use low-level
  persistence stores for fixtures and characterization checks.
- Production presentation files should not accept, pass, or import raw `ExecSql`
  values. Bind the executor inside stores/providers and expose domain-shaped
  actions or read models instead.
- Host tests and host test helpers should also consume the SDK root or
  workflow/store facades rather than `data/` internals. Low-level persistence
  characterization belongs in `packages/client-sdk` tests, not host tests.

`bun run lint:architecture` enforces the current high-confidence subset of
these rules for `packages/client-sdk/src`, `packages/app/src`, and
`packages/api/src`.
