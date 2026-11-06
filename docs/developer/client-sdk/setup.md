# Client SDK: Setup

Part of the [client SDK guide](../client-sdk.md).

## Quick Start

Create one SDK instance for the active client environment:

```ts
import { Tearleads } from "@tearleads/client-sdk";

const tearleads = new Tearleads();
```

Initialize a SQLite runtime per [SQLite setup](../sqlite-setup.md), then
configure the SDK before using persistence, sync, or identity generation:

```ts
tearleads.database.configure({
  client: sqliteRuntime.client,
  id: sqliteRuntime.id,
});

const { rootContainerId } = await tearleads.identity.generate();
```

Single-identity clients can pass `identityProvisioning: "auto"` instead of
calling `generate()`; see [Constructor Options](./configuration.md#constructor-options).
For local editing versus custom remote creation workflows, see
[Choosing a document creation API](../document-creation.md).

## Host Contract

`deviceFirst.open()` returns one shared handle. Reconciliation takes scoped
hints, and `enqueueIdleBackfill()` performs catch-up.
[Container](../../glossary/access.md#container) creation commits the container
and its metadata document in one compound API request. Create, link/unlink, projection,
and sync adapters provide structured `Result` methods that report complete
transport failures. Container persistence saves pending mutations atomically: an
accepted create or move saves its state and settles its exact intent revision in
one transaction, and an acknowledgment without that settlement is refused. Error
recording also checks the intent revision; settlement is never unconditional.

Startup creates missing tables and indexes but never alters existing ones, so a
local database whose tables do not match the current schema must be reset.

Verified [writer projections](../../glossary/sync.md#writer-projection) leave their
[access-manifest](../../glossary/access.md#access-manifest) bundles and
[container KEK](../../glossary/keys.md#container-kek) levels in the local
`verified_access_manifest_bundles` table (at most 1,024 rows, oldest evicted
first, cleared with an organization's remote reset). Later reads cite up to 48
from the read object's organization so the API omits those bytes; the SDK
refills and re-verifies them. The table is a byte cache, not a
[checkpoint](../../glossary/sync.md#checkpoint): losing it only makes reads
larger. See [incremental evidence](../../projection-policy-evidence.md#cost-and-retained-history-tradeoff).

[Principal-policy](../../glossary/principals.md#principal-policy-state) warming
verifies and persists its cache. Group policy writes pin an organization owner atomically
with current, history, and checkpoint rows, and the public policy-cache and
bundle-save types require that owner. Persisted group evidence without an owner
refuses scoped purge and requires a full local reset. The
[wire contract](../../protocol-specification.md) requires explicit
[commit-LSN](../../glossary/sync.md#commit-lsn) mode, inline-rekey commit
markers for nonempty batches, and the original document/blob
[write-authorization evidence](../../keying-design/content-keys.md#content-write-authorization).
See the [workflow contract](../../../packages/client-sdk/src/workflows/README.md)
for custom adapter details.
