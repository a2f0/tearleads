# App Data Architecture

The app keeps SQLite execution explicit. `ExecSql` carries the active database
connection, serialized mutation queue, and nested transaction behavior, so it
should not be replaced with a global database handle.

The intended dependency direction is:

```text
components/hooks -> providers/stores -> workflows -> persistence + sqlite + shared helpers
```

## Layers

- UI components, document-type components, and mini-app hooks render state and
  collect user intent.
- Store modules under `../stores/` own React context, subscriptions, sync
  scheduling, state machines, and event fanout.
- Workflows under `../workflows/` own multi-step app operations that compose API
  calls, local persistence, key/projection verification, and transaction
  boundaries.
- Persistence modules under `persistence/` are domain-specific SQLite stores.
  They keep taking explicit `ExecSql` values and should not import React,
  providers, UI, hooks, or workflows.
- SQLite internals under `sqlite/` own the executor adapter, Drizzle schema
  definitions, transaction serialization, and shared table helpers.
- Blob storage internals under `blobs/` own the OPFS/memory byte stores.
  Providers, stores, and presentation code should consume the blob workflow
  facade instead of importing these stores directly.
- Blob byte/store contracts live in `blobContracts.ts` so presentation and
  workflows can share typed attachment payloads without importing workflow
  barrels or storage internals.
- Sync coordination helpers under `sync/` own shared lane scheduling and
  prerequisite checks. Workflows compose them; presentation should stay behind
  stores/providers.
- Document summary contracts live in `documentSummary.ts` so presentation,
  stores, workflows, and persistence can share document read-model shapes
  without importing document shared-helper internals.
- Contact data internals under `contacts/` own low-level address-book record
  contracts and document serialization helpers. Providers, stores, and
  presentation code should consume the contacts workflow facade for contact
  read-model types.
- Shared helpers and domain read-model contracts hold pure or mostly pure
  projection, crypto, event, request, response validation, and view-facing data
  shapes that workflows and stores can reuse without importing provider or UI
  layers.

## Executor Boundary

Providers may create or receive the root app runtime and pass a workflow context
into workflow entry points. Inside persistence stores and transaction-scoped
workflow code, pass the active executor explicitly so all reads and writes share
the same SQLite connection and serialization boundary.

Provider/store code should not thread raw `ExecSql` through every intermediate
helper when a workflow context would express the operation more clearly. That
cleanup should be incremental and behavior-preserving.

## Rules

- Production `data/` modules must not import UI, providers, hooks, or
  workflows, including for type-only contracts. Test-only fixture builders that
  need workflow types belong under `packages/app/test/helpers/`.
- `workflows/` modules must not import UI, hooks, or providers, including for
  type-only contracts.
- Production `data/` and `workflows/` files must not import React; React hooks
  and runtime adapters belong in presentation or store/provider layers.
- Shared helper modules under document and container data domains must stay
  layer-neutral, including for type-only contracts.
- Production UI and mini-app hooks should go through stores or providers rather
  than importing persistence stores or `data/sqlite/` directly, including for
  type-only contracts. Runtime workflow calls and workflow-owned contracts
  should also stay behind stores or providers. Presentation should use neutral
  data contracts instead of importing document/container shared-helper internals
  directly.
- Production stores, providers, and identity runtime should consume domain
  workflow facades rather than importing `data/persistence/`, `data/sqlite/`,
  `data/blobs/`, or `data/contacts/` directly. The root
  `providers/data/AppDataProvider.tsx` is the executor construction boundary.
  Tests may still use low-level persistence stores for fixtures and
  characterization checks.
- Production presentation files should not accept, pass, or import raw `ExecSql`
  values. Bind the executor inside stores/providers and expose domain-shaped
  actions or read models instead.

`bun run lint:architecture` enforces the current high-confidence subset of
these rules for `packages/app/src` and `packages/api/src`.
