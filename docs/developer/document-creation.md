# Choosing a document creation API

Start with `tearleads.documents.open()` for normal host editing. The SDK opens
or creates local document state and its store coordinates persistence and
remote sync. Use a unique `localId` for a new document; reopening that ID
reuses its state. Initialize SQLite and generate or restore the identity first,
as described in the [SDK guide](client-sdk.md).

```ts
const store = tearleads.documents.open({
  localId: crypto.randomUUID(),
  containerId: rootContainerId,
  initialText: "My first note",
});
store.requestSync();
```

Opening the store is not an acknowledgment of server-side creation. Sync needs
a ready database, signing and encryption keys, an authenticated organization,
and network access. When those inputs change, the host updates the store with
`store.updateRuntime(tearleads.documents.workflowRuntime(containerId))` and
requests sync again. Observe the store's state for progress and errors.

In the React app, use the existing
[DocumentsProvider](../../packages/app/src/stores/documents/DocumentsProvider.tsx)
and its hooks. It wires these runtime updates and sync requests; presentation
components should go through providers and stores rather than import SQLite,
persistence, or SDK workflow internals.

## Custom workflow hosts

`createRemoteDocument` is a lower-level public workflow for hosts that supply
the database executor, crypto and verification inputs, API ports, and
persistence callbacks themselves. It constructs, submits, and acknowledges the
signed creation request; its nullable result must be handled, including deferred
creation while the containing folder is still pending.

`buildMaterializedDocumentCreatePlan` builds the signed/encrypted creation
material for a custom workflow. It does not submit or persist the document.
Choose this only when the host owns those remaining steps.

Both are named exports of `@tearleads/client-sdk`; use the package root rather
than private `src/` paths. The [workflow contract](../../packages/client-sdk/src/workflows/README.md)
describes the ports these custom hosts must provide. Most editing hosts should
let the document store compose them.
