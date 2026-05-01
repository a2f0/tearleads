# API Workflows

Workflows are transaction-scoped write orchestration for API operations that
must commit or roll back as one unit.

They sit between route-facing services and low-level access stores:

```text
routes -> services -> workflows -> access/read + access/write
```

Services keep request/session/runtime concerns at the API boundary. Workflows
own the atomic database operation and pass the same transaction executor through
all access-plane reads and writes they compose.

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

`containers/mutations.ts` is the first extracted workflow. The public service
facade remains at `services/containers/mutations.ts` so route imports stay
stable while the transaction implementation lives under `workflows/`.
