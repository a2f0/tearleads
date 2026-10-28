# Document priming after root verification

[`RootDocumentPriming.tla`](./RootDocumentPriming.tla) covers a scheduling race
created by signed destination checks: a pending document create can run before
its root's remote proof finishes. That pass defers the create; the
first durable remote acknowledgement must schedule another document pass.

| Model action or predicate | Production seam |
| --- | --- |
| `Prime` / `DocumentsWaitForRemoteRoot` | `isContainerAwaitingRemoteCreate` defers document creation while the container lacks a server timestamp |
| `AcknowledgeRoot` / `ReprimeAfterRemoteAcknowledgment` | `installUpdatedRemoteContainerState` requests document priming after the first durable remote acknowledgement |
| `FailAcknowledgement` / `AcknowledgeOnlyOnSuccess` / `RemoteRootIsAcknowledged` | a failed or refused acknowledgement leaves `isContainerAwaitingRemoteCreate` true, so the root stays local until a retry succeeds |
| `DeferredDocumentsAreScheduled` / `DocumentEventuallySyncs` | `primeStoreDocuments` reopens pending document stores and requests their sync |

An acknowledgement attempt may fail or be refused any number of times; only a
successful one marks the root remote (`RemoteRootIsAcknowledged`), and with the
retry fair the document still syncs. `AcknowledgeOnlyOnSuccess = FALSE` treats
a failed attempt as the acknowledgement, and the device releases documents into
a root the server does not hold. The model assumes a valid root proof
eventually arrives and the scheduled document pass runs fairly. It abstracts
document contents and subsequent container mutations. The negative control removes the priming
notification and strands a document whose first pass ran before acknowledgement.
Separate automated controls require both `DeferredDocumentsAreScheduled` and
`DocumentEventuallySyncs` to fail, so the safety check cannot mask a vacuous
eventual-sync property. The app regression pauses the real signed root
projection until the first document-priming pass has finished, then requires the
local document to sync.
