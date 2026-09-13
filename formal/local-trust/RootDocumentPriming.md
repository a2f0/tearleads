# Document priming after root verification

[`RootDocumentPriming.tla`](./RootDocumentPriming.tla) covers a scheduling race
exposed by the signed destination checks in #2266. A pending document create can
run before its root's remote proof finishes. That pass defers the create; the
first durable remote acknowledgement must schedule another document pass.

| Model action or predicate | Production seam |
| --- | --- |
| `Prime` / `DocumentsWaitForRemoteRoot` | `isContainerAwaitingRemoteCreate` defers document creation while the container lacks a server timestamp |
| `AcknowledgeRoot` / `ReprimeAfterRemoteAcknowledgment` | `installUpdatedRemoteContainerState` requests document priming after the first durable remote acknowledgement |
| `DeferredDocumentsAreScheduled` / `DocumentEventuallySyncs` | `primeStoreDocuments` reopens pending document stores and requests their sync |

The model assumes a valid root proof eventually arrives and the scheduled
document pass runs fairly. It abstracts network failures, document contents,
and subsequent container mutations. The negative control removes the priming
notification and strands a document whose first pass ran before acknowledgement.
The app regression pauses the real signed root projection until the first
document-priming pass has finished, then requires the local document to sync.
