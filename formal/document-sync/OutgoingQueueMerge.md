# Outgoing Queue Merge

[`OutgoingQueueMerge.tla`](./OutgoingQueueMerge.tla) models the send-time merge
of queued outgoing document updates (#2851). Every durable local write enqueues
its own row under a fresh update id. Before a sync pass sends the queue, it may
replace a run of consecutive ordinary local rows with one row that holds exactly
their operations. Two runtimes (two tabs, say) share the durable queue, and
each one sends, settles, re-keys, merges, and restarts on its own. The merge
runs inside the pass, so the merging runtime has nothing in flight. The other
runtime may still have members of the run in flight.

The server binds an update id to one payload for good. It stores a new id with
its content and refuses a whole request (409) that repeats a stored id. The
client encrypts every attempt again, so a retry is never byte-identical.
Settlement unqueues rows by id. After a conflict, the read-only recovery pass
settles the ids whose server copy matches the content captured at submit, and
re-keys every other submitted id that is still queued.

The abstraction maps to production at these seams:

| Model action or predicate | Production implementation |
| --- | --- |
| `Edit` | `insertDocumentPendingUpdateWithHistoryInTransaction` gives every local write its own row with a fresh `update_id` |
| `QueueFullState` | a rotation checkpoint (`enqueueDocumentPendingUpdateWithHistory` with a source version vector) or a remote-reset outbox row; `planQueuedUpdateMerge` never merges either and cuts a run at it |
| `BeginSubmit` | `selectDocumentSyncOutgoingBatch` sending queued rows in queue order |
| `Accept` / `Conflicted` | the server storing each new id with its content and answering 409 for a stored id; `assertRetryUpdateMatchesAcceptedContent` |
| `LoseAck` | a response lost after the server committed the request; the rows stay queued, so the next pass repeats their ids and `isRecoverableDocumentUpdateIdConflict` sends its 409 to recovery |
| `Settle` | `settleQueuedDocumentUpdatesInTransaction` for `acceptedOutgoingUpdateIds`, or `settledPendingUpdateIdsFromSync` after a conflict |
| `Rekey` / `RekeyedId` | `rekeyUnsettledRecoveryPendingUpdates` calling `rekeyDocumentPendingUpdate`, which compares the row's current `update_id` |
| `Restart` | `loadDocumentHistoryRestoreState` rebuilding the live document from durable history |
| `Merge` | `mergeQueuedDocumentUpdates` in `syncDocumentState`, after `prepareDocumentOutgoingCoverage`, inside `runDocumentRemoteWork` |
| `ProvesRow` | `updateMatchesDocumentHistory` against the live document, for rows with no source version vector and the update import mode |
| `ConsecutiveRun` / `Skipped` | `planQueuedUpdateMerge` taking runs of consecutive mergeable rows only; `replaceDocumentQueuedUpdates` refusing a run with another queued row between its members |
| `ExportedOps` / `SpansContiguous` | `exportUpdatesInVersionRange` over each peer's span from its first start to its last end; `planQueuedUpdateMerge` cutting a run at a per-peer gap |
| `FirstMember` / `MergedRowKeepsPosition` | `replaceQueuedPendingUpdates` updating the first member's row in place, so it keeps its `created_at` and rowid, and deleting the rest |
| `MergeReusesId` / `ServerIdContentStable` | `replaceDocumentQueuedUpdates` giving the merged row a fresh `update_id` |

The checked configuration sets every switch to its safe value. Its invariants
require that:

- every local operation is on the server or still queued (`NoLostLocalOps`);
- an update id never names two contents across the server, in-flight requests,
  and the queue (`ServerIdContentStable`);
- a row sits at its first member's position, and no member moves ahead of a row
  still queued between them (`MergedRowKeepsPosition`);
- a row holds exactly the operations its members were created with
  (`MergedRowHoldsExactOps`).

Three negative controls each relax one merge rule, and the negative-control
check asserts the named violation on every run. `MergeReusesId = TRUE` keeps the
first member's id. The other runtime's in-flight copy of that member is
accepted, and its settlement unqueues the merged row, so the newer operations
are lost: `NoLostLocalOps` fails. `ServerIdContentStable` fails one step sooner,
when the merged row and the in-flight copy share the id.
`MergeAcrossCheckpoint = TRUE` lets a run skip a queued full-state row, which
moves later operations ahead of the checkpoint: `MergedRowKeepsPosition`
fails. `MergeAcrossGap = TRUE` lets a run have a
per-peer gap. Here recovery settles the middle row of three and re-keys the
first, and the range export pulls the settled operation back into the merged
row: `MergedRowHoldsExactOps` fails.

The merge is one step: production's `replaceQueuedPendingUpdates` rechecks, in
one transaction, everything the plan relied on (each member still queued under
its id, consecutive, document id, and `recoveryGeneration`). A plan that a
concurrent settle, re-key, or merge invalidated changes nothing, which is the
model's disabled step. In the model the export comparison already refuses a
member the live document lacks, so `ProvesRow` is never the deciding guard.
Production also needs the proof, because the bytes of a row can differ from its
declared vectors. A merge can make the other runtime's in-flight copies arrive
twice under different ids. The server then stores those operations twice, which
CRDT import tolerates. This is the accepted cross-runtime cost; no durable
"submitted" marker prevents it.

Outside the model: the merge byte cap and the per-pass row limit, the rekey
budget beyond running out of fresh ids, encryption, signatures, and request
batch limits. A rotation checkpoint and a remote-reset outbox row are one
`fullState` kind, because the merge treats them alike. The configuration bounds
two runtimes, three operations, three queue rows, and four update ids. TLC
explores 5,003,291 generated and 833,835 distinct states at depth 24 in about
20 seconds with one worker. This is exhaustive bounded model checking, not an
unbounded proof.
