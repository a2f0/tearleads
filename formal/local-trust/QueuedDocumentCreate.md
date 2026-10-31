# Queued document creation after local purge

[`QueuedDocumentCreate.tla`](./QueuedDocumentCreate.tla) models a local document
store retained in the import queue after empty-trash deletes its durable row.
The store must check that row before beginning remote creation. If another
generation replaces the store while that read is pending, the old result must
not clear the replacement. Once started, the create may carry the document's
one queued row as its seed. The row may leave the queue only when the
server holds its content. A peer may edit the document after the create
commits; settling the seed skips the pass's pull, so a hint for that edit must
survive even when it arrives before the store holds the document's id. A
folder's metadata document is created the same way, with its first metadata
update as the seed, so the seams below name both lanes.

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
| `SubmitSeeded` | `submitPlannedDocumentCreateRequest` sends `buildDocumentCreateSeedRequest` as `initialSync`; `runCreateDocumentWorkflow` commits it with `commitDocumentCreateSeedInTransaction` in the create transaction |
| `SubmitPlain` | `submitPlannedDocumentCreateRequest` resubmits the plain create once after a refused seed |
| `Settle` / `RequireSeedAcknowledgement` | `committedSeedSettlement` settles the row only when `acceptedOutgoingUpdateIds` names it |
| `Adopt` / `KeepSeedOnAdoption` | `adoptExistingRemoteDocument` returns no create response, so `persistCreatedRemoteDocument` leaves the row queued |
| `SyncQueuedRow` | the queued row syncs through `syncRemoteDocument`; a seed already stored under its id fails `assertRetryUpdateMatchesAcceptedContent` because the row is encrypted again, and `settledPendingUpdateIdsFromSync` or `rekeyUnsettledRecoveryPendingUpdates` settles or re-keys it |
| `PeerEdit` / `KeepPlannedIdHints` | `ensureRemoteDocument` calls `recordPlannedRemoteDocumentId` before `createRemoteDocument`, so `hasRemoteDocumentUpdateEvent` matches a hint for that id before `persistCreatedRemoteDocument` installs it; a folder create runs inside `withPlannedMetadataDocumentId`, so `listContainerMetadataDocumentUpdateIds` queues a hint for its metadata document in `metadataDocumentIdsNeedingSync` |
| `IdInstalled` | `persistCreatedRemoteDocument` sets the record's `documentId` |
| `ClearOnlyConsumedSignal` | `ensureSeededRemoteDocument` calls `clearConsumedRemoteUpdateSignal` with the sequence the pass consumed, which a later hint has moved; a folder create leaves `metadataDocumentIdsNeedingSync` to `clearMetadataSyncQueueIfUnchanged` |
| `Pull` | `shouldSkipCleanScheduledDocumentSync` is false while `remoteUpdatePending`, so the pass pulls |
| `PeerEditIsPulled` | the creating pass or the queued row's `syncRemoteDocument` pulls the edit, or `handleDocumentRemoteEvents` schedules a pass for the surviving signal |
| `SettledSeedIsCommitted` | `ensureSeededRemoteDocument` re-lists the queue only after `onCommitted` |
| `SeedCommitsWithDocument` | `commitDocumentCreateSeedInTransaction` runs inside the create's `db.transaction` |

The model bounds one document, one queued attempt, and two store generations.
Two negative controls separately disable the durable-row guard and generation
guard; TLC must detect the corresponding safety violation. Two more settle the
seed on a plain acknowledgement and drop it on adoption; both break
`SettledSeedIsCommitted`. The last two drop a hint for the submitted id before
the response installs it, and let seed settlement clear a signal raised after
submission; both break `PeerEditIsPulled`. The implementation regressions are in
`documentStore/sync/remoteCreateAfterPurge.test.ts` and
`documentStore/sync/syncSeededCreate.test.ts`.

A document whose first update waits for its only attachment's bind maps onto
the same actions: `createRemoteDocument` signs that row against the create plan
without sending it (`deferredSeedUpdate`), the bind carries it as
`documentSync`, `persistBindCarriedSeed` settles it only when the bind's
acknowledgement names it (`RequireSeedAcknowledgement`), and a refused carry
binds plainly so the row syncs as an ordinary update (`SubmitPlain`,
`SyncQueuedRow`). The tests are in
`documentStore/initialization/deferredInitialUpdateCarried.integration.test.ts`.

The durable read and its continuation are separate actions. Purge can happen
before, during, or after them. The no-create guarantee covers a purge visible to
that read, including a note deleted while waiting in a long import queue. A purge
after the read or after network submission requires separate coordination; this
model does not claim cancellation of an in-flight create or atomicity between
local deletion and remote creation. It abstracts SQL transactions, signing,
network results, and remote identity adoption.
