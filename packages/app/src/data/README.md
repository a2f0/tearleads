# App Data Architecture

The app keeps SQLite execution explicit. `ExecSql` carries the active database
connection, serialized mutation queue, and nested transaction behavior, so it
should not be replaced with a global database handle.

The intended dependency direction is:

```text
components/hooks -> providers/stores -> workflows -> persistence + shared helpers
```

## Layers

- UI components, document-type components, and mini-app hooks render state and
  collect user intent.
- Providers and store modules own React context, subscriptions, sync scheduling,
  state machines, and event fanout.
- Workflows under `../workflows/` own multi-step app operations that compose API
  calls, local persistence, key/projection verification, and transaction
  boundaries.
- Persistence modules under `persistence/` are low-level SQLite stores and
  schema helpers. They keep taking explicit `ExecSql` values and should not
  import React, providers, UI, hooks, or workflows.
- Shared helpers hold pure or mostly pure projection, crypto, event, request,
  and response validation code that workflows and stores can reuse without
  importing provider or UI layers.

## Executor Boundary

Providers may create or receive the root app runtime and pass a workflow context
into workflow entry points. Inside persistence stores and transaction-scoped
workflow code, pass the active executor explicitly so all reads and writes share
the same SQLite connection and serialization boundary.

Provider/store code should not thread raw `ExecSql` through every intermediate
helper when a workflow context would express the operation more clearly. That
cleanup should be incremental and behavior-preserving.

## Rules

- `data/persistence/` modules must not import UI, providers, hooks, or
  workflows at runtime.
- `workflows/` modules must not import UI, hooks, or providers at runtime.
- Shared helper modules under document and container data domains must stay
  layer-neutral.
- Production UI and mini-app hooks should not import core SQLite runtime/schema
  internals directly.

`bun run lint:architecture` enforces the current high-confidence subset of
these rules for `packages/app/src` and `packages/api/src`.
