# Document move placement during background sync

[`DocumentMovePlacement.tla`](./DocumentMovePlacement.tla) models the local
placement of one document through two move intents, signed link/unlink replay,
delayed discovery, and delayed local reads. A pending intent owns local
placement; intermediate server membership must not make an optimistically
trashed item reappear in its source folder.

| Model action or predicate | Production seam |
| --- | --- |
| `QueueMove` | `createDocumentLinkHost` forwards `commitSideEffect` through `relinkDocumentStoreWithCommitSideEffect`; `moveRemoteDocumentLinkLocally` uses it to commit the intent and link projection with the document relink |
| `Link`, `Unlink`, `ProtectPending` | `filterWritableDocumentPlacements` prevents `relinkRemoteContainerDocument` from publishing intermediate links while an intent exists |
| `Settle`, `CheckRevision` | `settleDocumentMoveIntent` checks the exact intent revision and replaces links in the relink transaction; partial replay also checks ownership |
| `LoseResponse`, `CaptureSettledEpoch` | `containerDocumentAlreadyMovedResult` verifies the writer projection and persists its epoch and key state before clearing the intent |
| `ApplyTombstone`, `ProtectPendingTombstones` | `applyContainerDocumentTombstonesWithExec` uses `filterWritableDocumentPlacements` inside the deletion transaction |
| `ApplyListingTombstone`, `TombstonesRequireSignedEvidence` | `applyContainerDocumentTombstonesWithExec` deletes `documentContainerProjection` rows and repoints the primary container from unverified listing tombstones; the gate would require the verified document link set to omit the container |
| `MergeCurrentPage`, `KeepNewestPageLinks` | `mergeDiscoveredDocumentInputs` selects links from the newest access epoch across discovery lanes |
| `CapturePage`, `ApplyPage`, `CheckEpoch` | `discoverContainerDocuments` and `discoverAllContainerDocuments` carry the access epoch into `filterWritableDocumentPlacements`; `resolveDiscoveredDocumentPlacement` preserves newer placement and access state |
| `StartRead`, `FinishRead`, `CheckReadPlacement` | `saveDocumentRecord` publishes `placementChanged`; `refreshPersistedDocument` discards pending reads for structural writes before publication |
| `RefreshReadSummary`, `CheckReadMembership` | `listContainerContentsDocumentsForContainers` filters stale link IDs against the returned summaries and final link map |
| `StablePlacement`, `StableView` | `listContainerContentsDocumentsForContainers` and `loadContainerSummaries` expose the chosen local placement throughout replay |

The bounded model checks safety, with nine negative controls disabling
ownership, epoch, revision, read, discovery-merge, response-recovery, and
tombstone-evidence guards independently. Regression tests cover a refresh
between real signed link/unlink operations, sequential trash moves during
single and all-container discovery, superseded replay rollback, and
first-hydration reads. Production currently behaves like negative control
`listing-tombstone-removes-linked-container` until the issue is fixed.

The model abstracts cryptography, content, network failures, and SQL internals.
The local relink transaction includes intent enqueue or settlement and link
writes. The server still performs link and unlink separately; waiting in the
unlink phase models a failed request awaiting retry. The two destinations are
distinct, and each replay completes before another begins. Read sets abstract
membership while `readSummary` models a separately loaded preferred placement.
Production emits explicit placement metadata for creates, identity changes, and
structural relinks, including those that keep the same preferred container.
Reconciliation reads capture a local write revision in `loadContainerDelta`;
`applyReconciled` refuses a delta if a write or runtime reset intervened and
schedules a fresh local read. This model does not claim liveness without
network recovery or authority, or model arbitrary later moves by other devices.
