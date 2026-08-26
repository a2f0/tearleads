# Custom Document Persistence

Hosts that replace the built-in `DocumentsPersistence` adapter must implement
the complete current contract.

`createDocumentWithHistoryCheckpoint(...)` atomically creates the canonical
record, standard projections, host projection callback, birth history
checkpoint, and optional initial outgoing update plus matching history tail. A
callback or insertion failure rolls back every one of those effects. It returns
`null` when a concurrent initializer already owns the local id; the store then
adopts that winner and its durable history.

`enqueuePendingUpdate(...)` returns a boolean and atomically writes the outgoing
queue entry with the matching local durable-history tail entry. When
the expected write context is present, the adapter compares both
`expectedDocumentId` and `expectedRecoveryGeneration` with the canonical row
inside the same mutation. An absent or different context returns `false` and
writes neither row; this is a normal compare-and-set loss, not an exception.
`documentIdentityMatches(...)` performs the same canonical write-context check
for a no-op update, where there is no queue row to insert but a relink or raw
history recovery still must be observed before the caller reports success.

`commitDocumentMutation(...).attachmentStaging` compares the complete expected
canonical document record and then writes pending attachment rows, local
attachment projections, the outgoing CRDT update, and its durable-history tail
in one transaction. A mismatch changes no row. An insertion failure rolls the
whole stage back; adapters must not emulate rollback with later compensating
writes.

An atomic raw-history recovery increments the canonical record's
`recoveryGeneration`. Every enqueue and save compares the generation captured
before it waited for the mutation queue; a stale writer returns a compare-and-set
loss and reloads the recovered record rather than publishing old history.

`commitDocumentMutation(...)` conditionally writes an already-prepared mutation
only when the complete expected durable record still matches. Its history
checkpoint/tail changes, optional outgoing update and matching history tail,
accepted queue settlement, canonical rows, standard projections, and host
projection callback all share one adapter transaction. It returns the
authoritative current record on a compare-and-set loss so an ordinary local
writer can rebase and a sync response can adopt the winner. A failed comparison
must not enqueue the optional outgoing update.

`settleAcceptedPendingUpdates(...)` deletes acknowledged queue rows only while
the response's complete security identity still matches the canonical record.
It returns the authoritative record whether the comparison succeeds or loses.

`loadDocumentStoreState(...)` reads the canonical record, durable history,
pending attachments, and local attachment projections from one database
snapshot. Startup installs that coherent state as a unit; adapters must not
implement it as independent reads that can straddle a relink or key rotation.

`findLocalIdByDocumentId(...)` resolves duplicate local rows for one remote
document identity. It must prefer a row with queued updates or a non-null
`pendingBaseVersion` that differs from `snapshotEndVersion`, then use descending
`updatedAt` and descending local id as deterministic tie-breakers. Restart and
on-demand hydration use this result as the canonical local owner, so selecting
a newer shell ahead of an edited row can strand unsynced work.

## On-demand document lifecycle

The public `symcrypt.documents.findLocalIdByDocumentId(documentId)` performs
that local lookup only when SQLite is ready; `null` means unavailable or
unknown, and no network work starts. A host may generate a local id when no row
exists, then call `documents.open({ localId, documentId }, {
remoteSyncMode: "on-demand" })`. On-demand mode suppresses the initial remote
pull only when creating the backing store; an already-registered store keeps
its existing owners.

`requestRemoteSyncAndWait(signal)` returns `true` only after its requested sync
generation completes. Abort, coordinator invalidation, missing prerequisites,
or an incomplete remote response returns `false`. Hosts should abort when the
owning view unmounts. The final waiter cancels its cold probe only if no startup
or fire-and-forget `requestRemoteSync()` owner shares the work, and an
invalidated probe's late response is not persisted. Ordinary store activity can
subsequently re-arm a cancelled on-demand store.

`deleteDocumentSideRowsIfAbsent(...)` checks that the canonical row is absent,
deletes its orphaned queue/history/attachment/projection rows, and invokes the
host projection callback in one write transaction. A concurrent initializer
must either be observed and preserved or begin after cleanup commits.

`invalidatePullContinuation(...)` atomically replaces only the exact rejected
cursor and matching sync identity with the durable recovery marker. It returns
the authoritative current record after the compare-and-set (including after a
race loss), or `null` when the canonical row is absent. The store uses that
record to adopt progress written by another pane before retrying from page one.

This is a flag-day contract. The SDK has no compatibility path for previous
split-create, split-commit, void-enqueue, or optional identity-probe adapter
shapes.
