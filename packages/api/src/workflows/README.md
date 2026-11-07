# API Workflows

Workflows are transaction-scoped orchestration for API operations that need a
single database executor across composed access-plane reads and writes.

They sit between route-facing services and low-level access stores:

```text
routes -> services -> workflows -> access/read + access/write
```

Services keep request, session, and runtime concerns at the API boundary.
Workflows own the database operation and pass the same transaction executor
through every access-plane read and write they compose.

## Rules

- A workflow may import low-level [`access/read`](../access/read/) and
  [`access/write`](../access/write/) APIs.
- A workflow may import schema, adapters, validators, crypto helpers, and
  package-neutral API utilities.
- A workflow must not import from [`routes/`](../routes/) or
  [`services/`](../services/).
- Production routes call services, not workflows or [`access/`](../access/)
  modules.
- Production services call workflows for access-plane orchestration instead of
  composing [`access/`](../access/) modules.
- Multi-step writes that touch access manifests, KEK state, content-key bundles,
  attachment bindings, or principal state live here rather than opening ad hoc
  transactions in routes.

`bun run lint:architecture` enforces this dependency direction.

## Scope

Workflows are grouped by domain: [`auth/`](auth/), [`billing/`](billing/),
[`blobs/`](blobs/), [`containers/`](containers/),
[`documents/`](documents/), [`organizations/`](organizations/),
[`principals/`](principals/), and [`root/`](root/), plus the shared
keying read-access resolver ([`keyingReadAccess.ts`](keyingReadAccess.ts)),
signer key lookup
([`signerPublicKey.ts`](signerPublicKey.ts)), and regained-access tombstone
pruning
([`regainedAccessTombstones.ts`](regainedAccessTombstones.ts)). The container
and document writer-projection
resolvers live here because document and blob writes use them inside their
transaction to prove access. The route-facing facades stay under
[`services/`](../services/),
so routes depend on a stable seam while orchestration sits behind the workflow
boundary.

Document storage, sync-baseline, and edit-attribution helpers that are not
route-facing services live under [`../documents/`](../documents/). Workflows may
compose those
helpers with access read/write APIs inside a single transaction.
