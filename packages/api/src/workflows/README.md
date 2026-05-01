# API Workflows

Workflows are transaction-scoped orchestration for API operations that need a
single database executor across composed access-plane reads and writes.

They sit between route-facing services and low-level access stores:

```text
routes -> services -> workflows -> access/read + access/write
```

Services keep request/session/runtime concerns at the API boundary. Workflows
own the database operation and pass the same transaction executor through all
access-plane reads and writes they compose.

## Rules

- A workflow may import low-level `access/read` and `access/write` APIs.
- A workflow may import schema, adapters, validators, crypto helpers, and
  package-neutral API utilities.
- A workflow must not import from `routes/` or `services/`.
- Production routes should call services or workflows, not compose `access/`
  modules directly.
- Multi-step writes that touch access manifests, KEK state, content-key bundles,
  attachment bindings, or principal state should live here instead of opening
  ad hoc transactions in routes.

The dependency direction is enforced by `bun run lint:architecture`.

## Current Scope

Container, document, and blob attachment mutation implementations live under
`workflows/`. The container writer-projection resolver also lives here because
document and blob writes use it inside their transaction to prove write access.
The public service facades remain under `services/` so route imports stay
stable while transaction implementations live behind the workflow boundary.

Document storage, sync, and audit helpers that are not route-facing services
live under `../documents/`. Workflows may compose those helpers with access
read/write APIs inside a single transaction.
