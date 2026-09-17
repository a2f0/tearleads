# Queued document creation after local purge

[`QueuedDocumentCreate.tla`](./QueuedDocumentCreate.tla) models a local document
store retained in the import queue after empty-trash deletes its durable row.
The store must check that row before beginning remote creation. If another
generation replaces the store while that read is pending, the old result must
not clear the replacement.

| Model action or predicate | Production seam |
| --- | --- |
| `Purge` | `purgeLocalContainerDocument` deletes the durable document through `deletePersistedDocument` |
| `ReadDurableRow` | `hasDurableDocumentForCreate` loads the row before `createRemoteDocument` |
| `ReplaceGeneration` | The live store document changes while `loadDocument` is pending |
| `CheckCurrentGeneration` | `generationIsCurrent` is checked after the read, before changing the store |
| `Discard` | `markDocumentStoreRemoved` retires the stale in-memory record and document |
| `Start` | `ensureRemoteDocument` proceeds to `createRemoteDocument` |
| `PurgedQueueDoesNotStart` | `hasDurableDocumentForCreate` prevents creation when the queued attempt observes a missing row |
| `ReplacementStoreSurvives` | `generationIsCurrent` prevents an obsolete read from clearing a newer store generation |

The model bounds one document, one queued attempt, and two store generations.
Two negative controls separately disable the durable-row guard and generation
guard; TLC must detect the corresponding safety violation. The implementation
regressions are in `documentStore/remoteCreateAfterPurge.test.ts`.

The durable read and its continuation are separate actions. Purge can happen
before, during, or after them. The no-create guarantee covers a purge visible to
that read, including a note deleted while waiting in a long import queue. A purge
after the read or after network submission requires separate coordination; this
model does not claim cancellation of an in-flight create or atomicity between
local deletion and remote creation. It abstracts SQL transactions, signing,
network results, and remote identity adoption.
