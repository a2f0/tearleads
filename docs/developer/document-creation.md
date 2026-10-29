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
signed creation request. A non-null result is a verified creation or adoption
of a previously committed create after a lost response. `null` means no result
was adopted by this invocation; it does not establish whether the server
committed the request.

| Cause of `null` | What the custom host does |
| --- | --- |
| The containing folder's create is pending | Retry when that create settles. |
| `isRemoteSyncBlocked` blocks the organization | Resume after the block clears. |
| `stillCurrent()` becomes false, including during verification | Discard this invocation; let the current identity/store generation drive work. |
| A stable-ID retry finds an existing document but cannot fetch its projection yet | Retry with the same document ID to finish adoption. |
| Projection fetching, author access, or submission fails and invokes `onTerminalSubmitFailure` | Record the failure through that callback and apply the host's recovery policy; do not treat it as a silent deferral. |

Keep a stable `documentId` across retries. Cancellation after submission can
leave a committed remote document to adopt later. Verification failures and
unexpected errors can also reject the promise; handle rejection as well as
`null`. The normal document store supplies the failure recording, retry, and
generation checks. See the [create workflow](../../packages/client-sdk/src/workflows/documents/create/index.ts)
for the control flow and callback contract.

`buildMaterializedDocumentCreatePlan` builds the signed/encrypted creation
material for a custom workflow. It does not submit or persist the document.
Choose this only when the host owns those remaining steps.

Both are named exports of `@tearleads/client-sdk`; use the package root rather
than private `src/` paths. The [workflow contract](../../packages/client-sdk/src/workflows/README.md)
describes the ports these custom hosts must provide. Most editing hosts should
let the document store compose them.

## Tests and contract changes

New headless document-store behavior tests belong beside the SDK store in
[`packages/client-sdk/src/stores/documents/documentStore`](../../packages/client-sdk/src/stores/documents/documentStore/).
The similarly named app directory contains existing integration tests using
public SDK exports and app fixtures. Keep tests for React providers and app
wiring in the app; rebuild the SDK before running them.

For a new create-request field, update the shared operation/request contract in
[`packages/validators`](../../packages/validators/), run `bun run
generate:openapi`, and update the typed API client, SDK create-plan builder, and
API workflow validation that consume it. Add boundary tests, rebuild the SDK,
and run the relevant focused suites. Run `lint:openapi:compatibility`,
`lint:architecture`, and the broader handoff checks in
[verification](verification.md); a focused suite does not replace those gates.
