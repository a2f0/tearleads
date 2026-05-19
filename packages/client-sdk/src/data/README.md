# Client SDK Data Architecture

The client SDK keeps SQLite execution explicit. `ExecSql` carries the active
database connection, serialized mutation queue, and nested transaction
behavior, so it should not be replaced with a global database handle.

The intended dependency direction is:

```text
app adapters -> SDK stores -> SDK workflows -> data/persistence + data/sqlite + data/blobs + data/contacts + shared helpers
```

## Layers

- App UI, document-type components, and mini-app hooks live outside the SDK and
  call into SDK stores or workflow facades.
- Store modules under `../stores/` own subscriptions, sync scheduling, state
  machines, and event fanout without importing React.
- Workflows under `../workflows/` own multi-step app operations that compose API
  calls, local persistence, key/projection verification, and transaction
  boundaries.
- Persistence modules under `persistence/` are domain-specific SQLite stores.
  They keep taking explicit `ExecSql` values and should not import React,
  providers, UI, hooks, or workflows.
- SQLite internals under `sqlite/` own the executor adapter, Drizzle schema
  definitions, transaction serialization, and shared table helpers.
- Blob storage internals under `blobs/` own the OPFS/memory byte stores.
  App adapters and stores should consume the blob workflow facade instead of
  importing these stores directly.
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
  contracts and document serialization helpers. App adapters should consume the
  contacts workflow facade for contact read-model types.
- Shared helpers and domain read-model contracts hold pure or mostly pure
  projection, crypto, event, request, response validation, and view-facing data
  shapes that workflows and stores can reuse without importing provider or UI
  layers.

## Import Surface

`data/` is a low-level SDK surface, not the preferred application integration
API. Prefer the SDK root for neutral contracts and store or workflow facades for
app code. When low-level imports are needed, use concrete modules such as
`@tearleads/client-sdk/data/containers/containerMetadataDocument` or neutral
contracts such as `@tearleads/client-sdk/data/blobContracts` and
`@tearleads/client-sdk/data/documentSummary`.

Package subpath exports are explicit. Adding a new cross-package import from
`data/`, `stores/`, or `workflows/` should include a matching
`packages/client-sdk/package.json` export and should be treated as an SDK API
decision, even when the module is still low-level.

Use facade subpaths directly, such as `@tearleads/client-sdk/workflows/documents`
and `@tearleads/client-sdk/stores/documents`, instead of importing their
implementation `index` modules or nested store implementation files.

Avoid `index.ts`, `types.ts`, and other one-line re-export shims inside data
domains when they only shorten import paths. Keep a facade only when it marks a
real layer boundary, such as a workflow, store, provider, or explicit neutral
contract module shared by multiple layers.

## Executor Boundary

App adapters may create or receive the root SDK runtime and pass a workflow
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
these rules for `packages/client-sdk/src`, `packages/app/src`, and
`packages/api/src`.
