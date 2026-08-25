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
`expectedDocumentId` is present, the adapter compares it with the canonical row
inside the same mutation. An absent or different identity returns `false` and
writes neither row; this is a normal compare-and-set loss, not an exception.
`documentIdentityMatches(...)` performs the same canonical identity check for a
no-op update, where there is no queue row to insert but a relink still must be
observed before the caller reports success.

`commitDocumentMutation(...).attachmentStaging` compares the complete expected
canonical document record and then writes pending attachment rows, local
attachment projections, the outgoing CRDT update, and its durable-history tail
in one transaction. A mismatch changes no row. An insertion failure rolls the
whole stage back; adapters must not emulate rollback with later compensating
writes.

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

`invalidatePullContinuation(...)` atomically replaces only the exact rejected
cursor and matching sync identity with the durable recovery marker. It returns
the authoritative current record after the compare-and-set (including after a
race loss), or `null` when the canonical row is absent. The store uses that
record to adopt progress written by another pane before retrying from page one.

This is a flag-day contract. The SDK has no compatibility path for previous
split-create, split-commit, void-enqueue, or optional identity-probe adapter
shapes.
